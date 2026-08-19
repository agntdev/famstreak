import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { familyForMember, leaderboard } from "../habits.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "View Leaderboard", data: "leaderboard:view" }) if the toolkit exposes it.

registerMainMenuItem({ label: "🏆 Leaderboard", data: "leaderboard:view", order: 20 });
const composer = new Composer<Ctx>();

composer.callbackQuery("leaderboard:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = await familyForMember(ctx);
  if (!found) { await ctx.reply("No family leaderboard yet — join your family first."); return; }
  const rows = (await leaderboard(ctx, found.family)).slice(0, 10);
  const text = rows.length === 0 ? "No one has logged a habit yet — tap Log today to start the streak." : `Here’s the family leaderboard:\n\n${rows.map((m, index) => `${index + 1}. ${m.name} — ${m.points} points, ${m.streak}-day streak`).join("\n")}`;
  await ctx.reply(text, { reply_markup: inlineKeyboard([[inlineButton("Log today", "log:today")], [inlineButton("Back to menu", "menu:main")]]) });
});

export default composer;
