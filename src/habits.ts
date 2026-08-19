import type { Ctx } from "./bot.js";

export type GoalType = "check" | "number";
export interface Habit { id: string; name: string; goalType: GoalType; goal: number; points: number }
export interface Family { id: string; name: string; ownerId: string; habits: Habit[]; reminderTime?: string; remindersEnabled: boolean; mediaSharingEnabled: boolean; inviteCode: string; memberIds: string[] }
export interface Member { id: string; familyId: string; name: string; points: number }
export interface HabitLog { date: string; habitId: string; memberId: string; value: number }
export interface HabitCheck { userId: string; householdId: string; habitId: string; timestamp: number; date: string; mediaType: "photo" | "video" | "none"; mediaFileId?: string; thumbnailFileId?: string; reflectionText?: string; sessionId: string; value: number }

interface D1Statement { bind(...values: unknown[]): D1Statement; run(): Promise<unknown>; first<T>(): Promise<T | null> }
interface D1 { prepare(sql: string): D1Statement }
type EnvCtx = Ctx & { env?: { DB?: unknown } };

const key = (kind: string, id: string) => `habit:${kind}:${id}`;
const dbFor = (ctx: Ctx): D1 | undefined => (ctx as EnvCtx).env?.DB as D1 | undefined;

async function ready(db: D1): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS family_habit_data (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
}
async function get<T>(ctx: Ctx, k: string): Promise<T | undefined> {
  const db = dbFor(ctx); if (!db) return undefined;
  try {
    await ready(db);
    const row = await db.prepare("SELECT value FROM family_habit_data WHERE key = ?").bind(k).first<{ value: string }>();
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  } catch { return undefined; }
}
async function put<T>(ctx: Ctx, k: string, value: T): Promise<boolean> {
  const db = dbFor(ctx); if (!db) return false;
  try {
    await ready(db);
    await db.prepare("INSERT INTO family_habit_data(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, JSON.stringify(value)).run();
    return true;
  } catch { return false; }
}
export function memberId(ctx: Ctx): string | undefined { return ctx.from ? String(ctx.from.id) : undefined; }
/** Clock seam: tests or a Worker scheduler can replace this without changing date logic. */
export const clock = { now: (): number => Date.now() };
export function today(): string { return new Date(clock.now()).toISOString().slice(0, 10); }
export function dateBefore(date: string): string { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function id(): string { return crypto.randomUUID(); }

export async function familyForMember(ctx: Ctx): Promise<{ family: Family; member: Member } | undefined> {
  const mid = memberId(ctx); if (!mid) return undefined;
  const member = await get<Member>(ctx, key("member", mid));
  if (!member) return undefined;
  const family = await get<Family>(ctx, key("family", member.familyId));
  return family ? { family, member } : undefined;
}
export async function createFamily(ctx: Ctx, name: string, ownerId: string): Promise<Family | undefined> {
  const family: Family = { id: id(), name, ownerId, remindersEnabled: false, mediaSharingEnabled: false, inviteCode: id().replace(/-/g, "").slice(0, 10), memberIds: [ownerId], habits: [
    { id: id(), name: "Make your bed", goalType: "check", goal: 1, points: 1 },
    { id: id(), name: "Drink water", goalType: "number", goal: 8, points: 2 },
    { id: id(), name: "Read", goalType: "number", goal: 20, points: 2 },
  ] };
  const member: Member = { id: ownerId, familyId: family.id, name: "Parent", points: 0 };
  if (!(await put(ctx, key("family", family.id), family))) return undefined;
  await put(ctx, key("member", ownerId), member);
  await put(ctx, key("invite", family.inviteCode), family.id);
  return family;
}
export async function joinFamily(ctx: Ctx, code: string, name: string): Promise<Family | undefined> {
  const mid = memberId(ctx); if (!mid) return undefined;
  const fid = await get<string>(ctx, key("invite", code)); if (!fid) return undefined;
  const family = await get<Family>(ctx, key("family", fid)); if (!family) return undefined;
  const existing = await get<Member>(ctx, key("member", mid));
  if (existing && existing.familyId !== family.id) return undefined;
  if (!existing) { family.memberIds.push(mid); await put(ctx, key("member", mid), { id: mid, familyId: family.id, name, points: 0 }); await put(ctx, key("family", family.id), family); }
  return family;
}
export async function updateFamily(ctx: Ctx, family: Family): Promise<boolean> { return put(ctx, key("family", family.id), family); }
export async function leaveFamily(ctx: Ctx): Promise<"left" | "owner" | "none"> {
  const found = await familyForMember(ctx); if (!found) return "none";
  if (found.family.ownerId === found.member.id) return "owner";
  found.family.memberIds = found.family.memberIds.filter((id) => id !== found.member.id);
  if (!(await updateFamily(ctx, found.family))) return "none";
  await put(ctx, key("member", found.member.id), { ...found.member, familyId: "" });
  return "left";
}
export async function members(ctx: Ctx, family: Family): Promise<Member[]> { return (await Promise.all(family.memberIds.map((mid) => get<Member>(ctx, key("member", mid))))).filter((m): m is Member => Boolean(m)); }
export async function logHabit(ctx: Ctx, habit: Habit, value: number, date: string): Promise<{ streak: number } | undefined> {
  const found = await familyForMember(ctx); if (!found) return undefined;
  const { family, member } = found; if (!family.habits.some((h) => h.id === habit.id)) return undefined;
  const logKey = key("log", `${member.id}:${habit.id}:${date}`);
  const old = await get<HabitLog>(ctx, logKey); const qualifies = habit.goalType === "check" ? value >= 1 : value >= habit.goal;
  await put(ctx, logKey, { date, habitId: habit.id, memberId: member.id, value });
  if (!old && qualifies) { member.points += habit.points; await put(ctx, key("member", member.id), member); }
  let streak = 0; let cursor = date;
  for (let n = 0; n < 366; n += 1) { const log = await get<HabitLog>(ctx, key("log", `${member.id}:${habit.id}:${cursor}`)); if (!log || (habit.goalType === "number" && log.value < habit.goal)) break; streak += 1; cursor = dateBefore(cursor); }
  await put(ctx, key("streak", `${member.id}:${habit.id}`), { currentCount: streak, maxCount: streak });
  return { streak };
}
export async function saveHabitCheck(ctx: Ctx, habit: Habit, value: number, date: string, details: Pick<HabitCheck, "mediaType" | "mediaFileId" | "thumbnailFileId" | "reflectionText">): Promise<{ streak: number; check: HabitCheck } | undefined> {
  const found = await familyForMember(ctx);
  if (!found) return undefined;
  const result = await logHabit(ctx, habit, value, date);
  if (!result) return undefined;
  const check: HabitCheck = {
    userId: found.member.id, householdId: found.family.id, habitId: habit.id,
    timestamp: clock.now(), date, sessionId: String(ctx.chat?.id ?? found.member.id), value,
    mediaType: details.mediaType, mediaFileId: details.mediaFileId,
    thumbnailFileId: details.thumbnailFileId, reflectionText: details.reflectionText,
  };
  if (!(await put(ctx, key("check", `${check.userId}:${habit.id}:${date}`), check))) return undefined;
  return { ...result, check };
}
export async function habitCheck(ctx: Ctx, member: Member, habitId: string, date: string): Promise<HabitCheck | undefined> {
  return get<HabitCheck>(ctx, key("check", `${member.id}:${habitId}:${date}`));
}
export async function completedChecks(ctx: Ctx, family: Family, member: Member, date: string): Promise<Array<{ habit: Habit; check: HabitCheck }>> {
  const values = await Promise.all(family.habits.map(async (habit) => ({ habit, check: await habitCheck(ctx, member, habit.id, date) })));
  return values.filter((entry): entry is { habit: Habit; check: HabitCheck } => Boolean(entry.check));
}
export async function leaderboard(ctx: Ctx, family: Family): Promise<Array<Member & { streak: number }>> { const list = await members(ctx, family); const scored = await Promise.all(list.map(async (m) => { const streaks = await Promise.all(family.habits.map((h) => get<{ currentCount: number }>(ctx, key("streak", `${m.id}:${h.id}`)))); return { ...m, streak: Math.max(0, ...streaks.map((s) => s?.currentCount ?? 0)) }; })); return scored.sort((a, b) => b.points - a.points || b.streak - a.streak || a.name.localeCompare(b.name)); }

/** Sunday cron integration. It follows owner/member indexes only; it never scans storage. */
export async function sendWeeklySummary(env: { ADMIN_CHAT_ID?: string; BOT_TOKEN: string; DB?: unknown }): Promise<void> {
  const admin = env.ADMIN_CHAT_ID?.trim(); const db = env.DB as D1 | undefined;
  if (!admin || !db) return;
  try {
    await ready(db);
    const owner = await db.prepare("SELECT value FROM family_habit_data WHERE key = ?").bind(key("member", admin)).first<{ value: string }>();
    if (!owner) return;
    const member = JSON.parse(owner.value) as Member;
    const familyRow = await db.prepare("SELECT value FROM family_habit_data WHERE key = ?").bind(key("family", member.familyId)).first<{ value: string }>();
    if (!familyRow) return;
    const family = JSON.parse(familyRow.value) as Family;
    const allMembers = (await Promise.all(family.memberIds.map(async (mid) => { const row = await db.prepare("SELECT value FROM family_habit_data WHERE key = ?").bind(key("member", mid)).first<{ value: string }>(); return row ? JSON.parse(row.value) as Member : undefined; }))).filter((m): m is Member => Boolean(m));
    const end = today(); const dates: string[] = []; let cursor = end; for (let i = 0; i < 7; i += 1) { dates.push(cursor); cursor = dateBefore(cursor); }
    const lines: string[] = [];
    const missed: string[] = [];
    for (const m of allMembers) {
      let completed = 0; let mediaChecks = 0; let recentMisses = 0;
      for (const date of dates) {
        const day = await Promise.all(family.habits.map(async (h) => { const row = await db.prepare("SELECT value FROM family_habit_data WHERE key = ?").bind(key("log", `${m.id}:${h.id}:${date}`)).first<{ value: string }>(); return row ? JSON.parse(row.value) as HabitLog : undefined; }));
        completed += day.filter(Boolean).length;
        const checks = await Promise.all(family.habits.map(async (h) => {
          const row = await db.prepare("SELECT value FROM family_habit_data WHERE key = ?").bind(key("check", `${m.id}:${h.id}:${date}`)).first<{ value: string }>();
          return row ? JSON.parse(row.value) as HabitCheck : undefined;
        }));
        mediaChecks += checks.filter((check) => check?.mediaType !== "none").length;
      }
      for (const date of dates.slice(0, 3)) { const logs = await Promise.all(family.habits.map(async (h) => db.prepare("SELECT value FROM family_habit_data WHERE key = ?").bind(key("log", `${m.id}:${h.id}:${date}`)).first<{ value: string }>())); if (logs.every((r) => !r)) recentMisses += 1; }
      lines.push(`${m.name}: ${completed} habit${completed === 1 ? "" : "s"} logged${mediaChecks ? `, ${mediaChecks} with media 📎` : ""}`);
      if (recentMisses >= 3) missed.push(m.name);
    }
    const text = `This week’s ${family.name} summary:\n\n${lines.join("\n") || "No habits were logged this week."}${missed.length ? `\n\nA gentle nudge may help: ${missed.join(", ")} missed three days.` : ""}`;
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: admin, text }) });
  } catch { /* A scheduled notification must never crash the Worker. */ }
}
