import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { completedChecks, familyForMember, habitCheck, leaveFamily, saveHabitCheck, today } from "../habits.js";

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

registerMainMenuItem({ label: "✅ Log today", data: "log:today", order: 10 });
registerMainMenuItem({ label: "Leave family", data: "family:leave", order: 40 });
const composer = new Composer<Ctx>();

function clearCheck(ctx: Ctx): void {
  ctx.session.step = undefined;
  ctx.session.pendingHabit = undefined;
  ctx.session.pendingDate = undefined;
  ctx.session.pendingValue = undefined;
  ctx.session.pendingMediaType = undefined;
  ctx.session.pendingMediaFileId = undefined;
  ctx.session.pendingThumbnailFileId = undefined;
}

function habitMenu(found: NonNullable<Awaited<ReturnType<typeof familyForMember>>>) {
  const rows = found.family.habits.map((h) => [inlineButton(h.goalType === "check" ? `✓ ${h.name}` : `${h.name} (${h.goal})`, `log:habit:${h.id}`)]);
  rows.push([inlineButton("Log another day", "log:retro"), inlineButton("Back to menu", "menu:main")]);
  return inlineKeyboard(rows);
}

async function confirmation(ctx: Ctx, receipt: "media" | "reflection" | "plain"): Promise<void> {
  const found = await familyForMember(ctx);
  if (!found) return;
  const checks = await completedChecks(ctx, found.family, found.member, today());
  const listed = checks.map(({ habit, check }) => `${check.mediaType === "none" ? "✓" : "📎"} ${habit.name}`);
  const completed = listed.length === 1
    ? `You completed ${listed[0]} today.`
    : `You’re done for today — you completed: ${listed.join(", ")}.`;
  const saved = receipt === "media" ? "Your media and reflection were received."
    : receipt === "reflection" ? "Your reflection was received."
      : "Your check-in was saved.";
  const mediaRows = checks.filter(({ check }) => check.mediaType !== "none").map(({ habit }) => [inlineButton(`View ${habit.name} media`, `check:view:${habit.id}`)]);
  await ctx.reply(`${completed}\n${saved}`, { reply_markup: inlineKeyboard([...mediaRows, [inlineButton("Log another habit", "log:today"), inlineButton("Back to menu", "menu:main")]]) });
}

async function submitCheck(ctx: Ctx, reflectionText?: string): Promise<void> {
  const found = await familyForMember(ctx);
  const habit = found?.family.habits.find((item) => item.id === ctx.session.pendingHabit);
  const date = ctx.session.pendingDate;
  const value = ctx.session.pendingValue;
  const mediaType = ctx.session.pendingMediaType ?? "none";
  const mediaFileId = ctx.session.pendingMediaFileId;
  if (!found || !habit || !date || value === undefined || (mediaType !== "none" && !mediaFileId)) {
    clearCheck(ctx);
    await ctx.reply("That check-in expired. Tap Log today and try again.");
    return;
  }
  const result = await saveHabitCheck(ctx, habit, value, date, { mediaType, mediaFileId, thumbnailFileId: ctx.session.pendingThumbnailFileId, reflectionText });
  clearCheck(ctx);
  if (!result) { await ctx.reply("I couldn’t save that just now. Try again in a moment."); return; }
  await confirmation(ctx, mediaType !== "none" ? "media" : reflectionText ? "reflection" : "plain");
}

function checkChoices(habitName: string) {
  return inlineKeyboard([
    [inlineButton("Photo", "check:media:photo"), inlineButton("Video", "check:media:video")],
    [inlineButton("Text only", "check:text"), inlineButton("Cancel", "check:cancel")],
  ]);
}

composer.callbackQuery("log:today", async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = await familyForMember(ctx);
  if (!found) { await ctx.reply("You’re not in a family yet — ask a parent for the join link."); return; }
  await ctx.reply("What did you do today?", { reply_markup: habitMenu(found) });
});

composer.callbackQuery(/^log:habit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = await familyForMember(ctx);
  const habit = found?.family.habits.find((item) => item.id === ctx.match[1]);
  if (!found || !habit) { await ctx.reply("I couldn’t find that habit. Tap Log today and try again."); return; }
  ctx.session.pendingHabit = habit.id;
  ctx.session.pendingDate = ctx.session.pendingDate ?? today();
  if (habit.goalType === "number" && ctx.session.pendingValue === undefined) {
    ctx.session.step = "retro_value";
    await ctx.reply(`How many for ${habit.name}? Send a number.`);
    return;
  }
  ctx.session.step = undefined;
  ctx.session.pendingValue = 1;
  await ctx.reply(`Nice work on ${habit.name}. How would you like to check in?`, { reply_markup: checkChoices(habit.name) });
});

composer.callbackQuery("check:media:photo", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.pendingHabit || ctx.session.pendingValue === undefined) { await ctx.reply("Choose a habit first, then try again."); return; }
  ctx.session.pendingMediaType = "photo";
  await ctx.reply("Send one photo for this check-in. It can be up to 20 MB.", { reply_markup: inlineKeyboard([[inlineButton("Cancel", "check:cancel")]]) });
});
composer.callbackQuery("check:media:video", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.pendingHabit || ctx.session.pendingValue === undefined) { await ctx.reply("Choose a habit first, then try again."); return; }
  ctx.session.pendingMediaType = "video";
  await ctx.reply("Send one video for this check-in. It can be up to 20 MB.", { reply_markup: inlineKeyboard([[inlineButton("Cancel", "check:cancel")]]) });
});
composer.callbackQuery("check:text", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.pendingHabit || ctx.session.pendingValue === undefined) { await ctx.reply("Choose a habit first, then try again."); return; }
  ctx.session.pendingMediaType = "none";
  ctx.session.step = "check_reflection";
  await ctx.reply("Add a short reflection, or tap Skip to save your check-in.", { reply_markup: inlineKeyboard([[inlineButton("Skip", "check:skip"), inlineButton("Cancel", "check:cancel")]]) });
});
composer.callbackQuery("check:skip", async (ctx) => { await ctx.answerCallbackQuery(); await submitCheck(ctx); });
composer.callbackQuery("check:cancel", async (ctx) => { await ctx.answerCallbackQuery(); clearCheck(ctx); await ctx.reply("No check-in was saved. Tap Log today whenever you’re ready."); });

composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.pendingMediaType !== "photo") return next();
  const photo = ctx.message.photo.at(-1);
  if (!photo || (photo.file_size ?? 0) > MAX_MEDIA_BYTES) { await ctx.reply("That photo is too large. Send one up to 20 MB, or choose Text only."); return; }
  ctx.session.pendingMediaFileId = photo.file_id;
  ctx.session.pendingThumbnailFileId = ctx.message.photo[0]?.file_id;
  ctx.session.step = "check_reflection";
  await ctx.reply("Photo received. Add a short reflection, or tap Skip to finish.", { reply_markup: inlineKeyboard([[inlineButton("Skip", "check:skip"), inlineButton("Cancel", "check:cancel")]]) });
});
composer.on("message:video", async (ctx, next) => {
  if (ctx.session.pendingMediaType !== "video") return next();
  if ((ctx.message.video.file_size ?? 0) > MAX_MEDIA_BYTES) { await ctx.reply("That video is too large. Send one up to 20 MB, or choose Text only."); return; }
  ctx.session.pendingMediaFileId = ctx.message.video.file_id;
  ctx.session.pendingThumbnailFileId = ctx.message.video.thumbnail?.file_id;
  ctx.session.step = "check_reflection";
  await ctx.reply("Video received. Add a short reflection, or tap Skip to finish.", { reply_markup: inlineKeyboard([[inlineButton("Skip", "check:skip"), inlineButton("Cancel", "check:cancel")]]) });
});

composer.callbackQuery(/^check:view:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = await familyForMember(ctx);
  const check = found ? await habitCheck(ctx, found.member, ctx.match[1], today()) : undefined;
  if (!found || !check?.mediaFileId) { await ctx.reply("That media isn’t available anymore."); return; }
  if (!found.family.mediaSharingEnabled && check.userId !== found.member.id) { await ctx.reply("Media sharing is off for this family."); return; }
  if (check.mediaType === "photo") await ctx.replyWithPhoto(check.mediaFileId, { caption: check.reflectionText });
  else await ctx.replyWithVideo(check.mediaFileId, { caption: check.reflectionText });
});

composer.callbackQuery("log:retro", async (ctx) => { await ctx.answerCallbackQuery(); clearCheck(ctx); ctx.session.step = "retro_date"; await ctx.reply("Which day? Send it as YYYY-MM-DD."); });
composer.callbackQuery("family:leave", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Leave this family? Your past logs stay in the family summary.", { reply_markup: inlineKeyboard([[inlineButton("Leave family", "family:leave:confirm"), inlineButton("Keep me here", "menu:main")]]) }); });
composer.callbackQuery("family:leave:confirm", async (ctx) => { await ctx.answerCallbackQuery(); const outcome = await leaveFamily(ctx); await ctx.reply(outcome === "left" ? "You’ve left the family. You can join another one whenever you have a link." : outcome === "owner" ? "You’re the family parent, so you can’t leave while you’re the only administrator." : "You’re not in a family right now."); });

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (ctx.session.step === "check_reflection") {
    if (text.length > 500) { await ctx.reply("Keep your reflection under 500 characters."); return; }
    await submitCheck(ctx, text || undefined);
    return;
  }
  if (ctx.session.step === "retro_date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`))) { await ctx.reply("Use a real date like 2026-08-19."); return; }
    ctx.session.pendingDate = text; ctx.session.step = undefined; await ctx.reply("Now tap the habit you completed."); return;
  }
  if (ctx.session.step !== "retro_value" || !ctx.session.pendingHabit || !ctx.session.pendingDate) return next();
  const value = Number(text); const found = await familyForMember(ctx); const habit = found?.family.habits.find((item) => item.id === ctx.session.pendingHabit);
  if (!Number.isFinite(value) || value < 0) { await ctx.reply("Send a whole number or decimal of zero or more."); return; }
  if (!habit) { clearCheck(ctx); await ctx.reply("That check-in expired. Tap Log today and try again."); return; }
  ctx.session.step = undefined; ctx.session.pendingValue = value;
  await ctx.reply(`Nice work on ${habit.name}. How would you like to check in?`, { reply_markup: checkChoices(habit.name) });
});

composer.on("message", async (ctx, next) => {
  if (ctx.session.step === "check_reflection") {
    await ctx.reply("Send a short reflection, or tap Skip to finish.");
    return;
  }
  if (ctx.session.pendingMediaType === "photo" || ctx.session.pendingMediaType === "video") {
    await ctx.reply(`Send a ${ctx.session.pendingMediaType}, or tap Cancel to stop.`);
    return;
  }
  return next();
});

export default composer;
