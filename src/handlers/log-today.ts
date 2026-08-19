import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { familyForMember, leaveFamily, logHabit, today } from "../habits.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "Log Today's Habits", data: "log:today" }) if the toolkit exposes it.

registerMainMenuItem({ label: "✅ Log today", data: "log:today", order: 10 });
registerMainMenuItem({ label: "Leave family", data: "family:leave", order: 40 });
const composer = new Composer<Ctx>();

composer.callbackQuery("log:today", async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = await familyForMember(ctx);
  if (!found) { await ctx.reply("You’re not in a family yet — ask a parent for the join link."); return; }
  const rows = found.family.habits.map((h) => [inlineButton(h.goalType === "check" ? `✓ ${h.name}` : `${h.name} (${h.goal})`, `log:habit:${h.id}`)]);
  rows.push([inlineButton("Log another day", "log:retro"), inlineButton("Back to menu", "menu:main")]);
  await ctx.reply("What did you do today?", { reply_markup: inlineKeyboard(rows) });
});

composer.callbackQuery(/^log:habit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const found = await familyForMember(ctx); const habit = found?.family.habits.find((h) => h.id === ctx.match[1]);
  if (!found || !habit) { await ctx.reply("I couldn’t find that habit. Tap Log today and try again."); return; }
  if (habit.goalType === "number") { ctx.session.step = "retro_value"; ctx.session.pendingHabit = habit.id; ctx.session.pendingDate = today(); await ctx.reply(`How many for ${habit.name}? Send a number.`); return; }
  const result = await logHabit(ctx, habit, 1, today());
  await ctx.reply(result ? `${habit.name} is logged. Your streak is ${result.streak} day${result.streak === 1 ? "" : "s"}.` : "I couldn’t save that just now. Try again in a moment.");
});
composer.callbackQuery("log:retro", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = "retro_date"; await ctx.reply("Which day? Send it as YYYY-MM-DD."); });
composer.callbackQuery("family:leave", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Leave this family? Your past logs stay in the family summary.", { reply_markup: inlineKeyboard([[inlineButton("Leave family", "family:leave:confirm"), inlineButton("Keep me here", "menu:main")]]) }); });
composer.callbackQuery("family:leave:confirm", async (ctx) => { await ctx.answerCallbackQuery(); const outcome = await leaveFamily(ctx); await ctx.reply(outcome === "left" ? "You’ve left the family. You can join another one whenever you have a link." : outcome === "owner" ? "You’re the family parent, so you can’t leave while you’re the only administrator." : "You’re not in a family right now."); });
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step === "retro_date") { const date = ctx.message.text.trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) { await ctx.reply("Use a real date like 2026-08-19."); return; } ctx.session.pendingDate = date; ctx.session.step = undefined; await ctx.reply("Now tap the habit you completed."); return; }
  if (ctx.session.step !== "retro_value" || !ctx.session.pendingHabit || !ctx.session.pendingDate) return next();
  const value = Number(ctx.message.text.trim()); const found = await familyForMember(ctx); const habit = found?.family.habits.find((h) => h.id === ctx.session.pendingHabit);
  if (!Number.isFinite(value) || value < 0) { await ctx.reply("Send a whole number or decimal of zero or more."); return; }
  ctx.session.step = undefined; ctx.session.pendingHabit = undefined; const result = habit ? await logHabit(ctx, habit, value, ctx.session.pendingDate) : undefined; ctx.session.pendingDate = undefined;
  await ctx.reply(result ? `${habit?.name} is logged. Your streak is ${result.streak} day${result.streak === 1 ? "" : "s"}.` : "I couldn’t save that just now. Try again in a moment.");
});

export default composer;
