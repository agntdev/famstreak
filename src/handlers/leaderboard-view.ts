import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { familyForMember, habitCheck, leaderboard, today } from "../habits.js";

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
  const media = await Promise.all(rows.map(async (member) => ({
    member,
    checks: await Promise.all(found.family.habits.map((habit) => habitCheck(ctx, member, habit.id, today()))),
  })));
  const text = rows.length === 0 ? "No one has logged a habit yet — tap Log today to start the streak." : `Here’s the family leaderboard:\n\n${media.map(({ member, checks }, index) => `${index + 1}. ${member.name} — ${member.points} points, ${member.streak}-day streak${checks.some((check) => check?.mediaType !== "none") ? " 📎" : ""}`).join("\n")}`;
  const mediaRows = found.family.mediaSharingEnabled
    ? media.flatMap(({ member, checks }) => checks.flatMap((check) => check && check.mediaType !== "none" ? [[inlineButton(`View ${member.name}'s check-in`, `media:view:${member.id}:${check.habitId}`)]] : []))
    : [];
  await ctx.reply(text, { reply_markup: inlineKeyboard([...mediaRows, [inlineButton("Log today", "log:today")], [inlineButton("Back to menu", "menu:main")]]) });
});

composer.callbackQuery(/^media:view:([^:]+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = await familyForMember(ctx);
  if (!found || !found.family.mediaSharingEnabled) { await ctx.reply("Media sharing is off for this family."); return; }
  const member = (await leaderboard(ctx, found.family)).find((entry) => entry.id === ctx.match[1]);
  const check = member ? await habitCheck(ctx, member, ctx.match[2], today()) : undefined;
  if (!check?.mediaFileId) { await ctx.reply("That media isn’t available anymore."); return; }
  if (check.mediaType === "photo") await ctx.replyWithPhoto(check.mediaFileId, { caption: check.reflectionText });
  else await ctx.replyWithVideo(check.mediaFileId, { caption: check.reflectionText });
});

export default composer;
