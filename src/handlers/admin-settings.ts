import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { createFamily, familyForMember, memberId, updateFamily } from "../habits.js";

registerMainMenuItem({ label: "⚙️ Family settings", data: "admin:settings", order: 30 });
const composer = new Composer<Ctx>();

function settingsKeyboard(hasFamily: boolean) {
  return inlineKeyboard(hasFamily ? [
    [inlineButton("Add a habit", "admin:habit:add"), inlineButton("Manage habits", "admin:habit:list")],
    [inlineButton("Set reminder time", "admin:reminder:time"), inlineButton("Toggle reminders", "admin:reminder:toggle")],
    [inlineButton("Share join link", "admin:invite")],
    [inlineButton("Back to menu", "menu:main")],
  ] : [[inlineButton("Create family", "admin:family:create")], [inlineButton("Back to menu", "menu:main")]]);
}

composer.callbackQuery("admin:settings", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await ctx.answerCallbackQuery();
  const found = await familyForMember(ctx);
  await ctx.reply(found ? `Your family settings are ready. Reminders are ${found.family.remindersEnabled ? "on" : "off"}.` : "Start by creating your family. You can add habits and reminders next.", { reply_markup: settingsKeyboard(Boolean(found)) });
});

composer.callbackQuery("admin:family:create", async (ctx) => {
  if (!(await requireOwner(ctx))) return; await ctx.answerCallbackQuery();
  if (await familyForMember(ctx)) { await ctx.reply("Your family is already set up."); return; }
  ctx.session.step = "family_name";
  await ctx.reply("What’s your family name? Send up to 40 letters.");
});

composer.callbackQuery("admin:habit:add", async (ctx) => {
  if (!(await requireOwner(ctx))) return; await ctx.answerCallbackQuery(); ctx.session.step = "habit_name";
  await ctx.reply("What habit would you like to add? Send a short name.");
});

composer.callbackQuery("admin:habit:list", async (ctx) => {
  if (!(await requireOwner(ctx))) return; await ctx.answerCallbackQuery(); const found = await familyForMember(ctx);
  if (!found || found.family.habits.length === 0) { await ctx.reply("No habits yet — tap Add a habit to create one."); return; }
  await ctx.reply(`Your habits:\n\n${found.family.habits.map((h) => `• ${h.name} — ${h.goalType === "check" ? "done" : `${h.goal} per day`}`).join("\n")}`, { reply_markup: inlineKeyboard([...found.family.habits.map((h) => [inlineButton(`Remove ${h.name}`, `admin:habit:remove:${h.id}`)]), [inlineButton("Back to settings", "admin:settings")]]) });
});

composer.callbackQuery(/^admin:habit:remove:(.+)$/, async (ctx) => {
  if (!(await requireOwner(ctx))) return; await ctx.answerCallbackQuery(); const found = await familyForMember(ctx); if (!found) return;
  const habit = found.family.habits.find((h) => h.id === ctx.match[1]); if (!habit) { await ctx.reply("That habit is already gone."); return; }
  found.family.habits = found.family.habits.filter((h) => h.id !== habit.id); await updateFamily(ctx, found.family);
  await ctx.reply(`${habit.name} is removed. You can add another habit whenever you like.`, { reply_markup: settingsKeyboard(true) });
});

composer.callbackQuery("admin:reminder:toggle", async (ctx) => {
  if (!(await requireOwner(ctx))) return; await ctx.answerCallbackQuery(); const found = await familyForMember(ctx); if (!found) { await ctx.reply("Create your family first."); return; }
  found.family.remindersEnabled = !found.family.remindersEnabled; await updateFamily(ctx, found.family);
  await ctx.reply(found.family.remindersEnabled ? "Daily reminders are on. Set a time if you haven’t already." : "Daily reminders are off, so nobody will be nudged.", { reply_markup: settingsKeyboard(true) });
});

composer.callbackQuery("admin:reminder:time", async (ctx) => {
  if (!(await requireOwner(ctx))) return; await ctx.answerCallbackQuery(); if (!(await familyForMember(ctx))) { await ctx.reply("Create your family first."); return; }
  ctx.session.step = "reminder_time"; await ctx.reply("What time should reminders arrive? Send HH:MM in your local time.");
});

composer.callbackQuery("admin:invite", async (ctx) => {
  if (!(await requireOwner(ctx))) return; await ctx.answerCallbackQuery(); const found = await familyForMember(ctx); if (!found) { await ctx.reply("Create your family first."); return; }
  const username = ctx.me.username; const link = username ? `https://t.me/${username}?start=${found.family.inviteCode}` : `Open the bot and send /start ${found.family.inviteCode}`;
  await ctx.reply(`Share this join link with your family:\n${link}\n\nThey choose their own name when they open it.`);
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (ctx.session.step === "family_name") {
    if (text.length < 1 || text.length > 40 || !memberId(ctx)) { await ctx.reply("Use a family name with up to 40 letters."); return; }
    const family = await createFamily(ctx, text, memberId(ctx)!); ctx.session.step = undefined;
    await ctx.reply(family ? `${family.name} is ready! I added a few everyday habits to get you started.` : "I couldn’t save your family just now. Try again in a moment.", { reply_markup: family ? settingsKeyboard(true) : settingsKeyboard(false) }); return;
  }
  if (ctx.session.step === "habit_name") {
    if (text.length < 1 || text.length > 30) { await ctx.reply("Use a short habit name with up to 30 letters."); return; }
    ctx.session.pendingHabit = text; ctx.session.step = "habit_goal"; await ctx.reply("Send 1 for a simple done/not-done habit, or a larger daily number goal."); return;
  }
  if (ctx.session.step === "habit_goal") {
    const goal = Number(text); const found = await familyForMember(ctx); if (!Number.isFinite(goal) || goal < 1 || goal > 10000) { await ctx.reply("Send a number from 1 to 10,000."); return; }
    if (!found || !ctx.session.pendingHabit) { ctx.session.step = undefined; await ctx.reply("That setup expired. Open Family settings and try again."); return; }
    found.family.habits.push({ id: crypto.randomUUID(), name: ctx.session.pendingHabit, goalType: goal === 1 ? "check" : "number", goal, points: goal === 1 ? 1 : 2 }); await updateFamily(ctx, found.family); ctx.session.step = undefined; ctx.session.pendingHabit = undefined;
    await ctx.reply("That habit is ready for the family.", { reply_markup: settingsKeyboard(true) }); return;
  }
  if (ctx.session.step === "reminder_time") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) { await ctx.reply("Use a time like 07:30."); return; }
    const found = await familyForMember(ctx); if (!found) { ctx.session.step = undefined; await ctx.reply("That setup expired. Open Family settings and try again."); return; }
    found.family.reminderTime = text; await updateFamily(ctx, found.family); ctx.session.step = undefined; await ctx.reply(`Reminders are set for ${text}.`, { reply_markup: settingsKeyboard(true) }); return;
  }
  return next();
});

export default composer;
