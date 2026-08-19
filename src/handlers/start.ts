import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { familyForMember, joinFamily } from "../habits.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

const WELCOME = "Build small wins together. Tap a button to get started.";

composer.command("start", async (ctx) => {
  const code = ctx.match?.trim();
  if (code) {
    ctx.session.step = "member_name";
    ctx.session.pendingInvite = code;
    await ctx.reply("You’re joining a family. What should we call you?", { reply_markup: inlineKeyboard([[inlineButton("Cancel", "menu:main")]]) });
    return;
  }
  const existing = await familyForMember(ctx);
  if (!existing) {
    await ctx.reply("Welcome! A parent can set up your family, then share its join link with everyone.", { reply_markup: mainMenuKeyboard() });
    return;
  }
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "member_name" || !ctx.session.pendingInvite) return next();
  const name = ctx.message.text.trim();
  if (name.length < 1 || name.length > 30) { await ctx.reply("Use a name with up to 30 letters, then try again."); return; }
  const family = await joinFamily(ctx, ctx.session.pendingInvite, name);
  ctx.session.step = undefined; ctx.session.pendingInvite = undefined;
  await ctx.reply(family ? `You’re in ${family.name}! Tap Log today when you’re ready.` : "That join link doesn’t work anymore. Ask your parent for a fresh one.", { reply_markup: mainMenuKeyboard() });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;
