# Family Habit Tracker — Bot specification

**Archetype:** custom

**Voice:** warm and encouraging — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot for family habit tracking with streaks, leaderboards, and weekly summaries. Parents manage households, members log habits via buttons, and the bot tracks progress with friendly competition.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- small families (3-8 members)
- parents seeking habit-building tools
- children/teens with daily routines

## Success criteria

- Daily habit logs from all family members
- Weekly summaries delivered to parent
- Leaderboard updates visible to all members

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with habit logging and leaderboard
- **Log Today's Habits** (button, actor: user, callback: log:today) — Open habit selection buttons for current day
  - inputs: habit selection, numeric values for goals
  - outputs: confirmation message, updated streak counter
- **View Leaderboard** (button, actor: user, callback: leaderboard:view) — Show top 10 family members by points
  - outputs: ranked list with points and streaks
- **Admin Settings** (button, actor: user, callback: admin:settings) — Configure habits and reminders (parent-only)
  - inputs: habit edits, reminder time
  - outputs: configuration confirmation

## Flows

### Family Onboarding
_Trigger:_ /start first-time

1. Parent creates family
2. Generate join link
3. Members join via link

_Data touched:_ Family, Member

### Daily Logging
_Trigger:_ log:today button

1. Show habit buttons
2. Record completion/numeric value
3. Update streaks

_Data touched:_ Log, Streak

### Weekly Summary
_Trigger:_ Sunday 8:00 AM

1. Calculate totals
2. Generate report
3. Send to ADMIN_CHAT_ID

_Data touched:_ Leaderboard, Log

### Reminder Setup
_Trigger:_ admin:settings

1. Toggle reminders
2. Set time
3. Save to Family config

_Data touched:_ Family

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Receive weekly summaries and alerts
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **Family** _(retention: persistent)_ — Parent-managed household group
  - fields: name, owner_id, habits, reminder_time, members
- **Member** _(retention: persistent)_ — Device/session-identified user
  - fields: telegram_session_id, name, family_id
- **Habit** _(retention: persistent)_ — Daily goal with tracking rules
  - fields: name, goal_type, schedule, points_value
- **Log** _(retention: persistent)_ — Daily habit completion record
  - fields: date, habit_id, member_id, value
- **Streak** _(retention: persistent)_ — Consecutive completion counter
  - fields: habit_id, member_id, current_count, max_count
- **LeaderboardEntry** _(retention: derived)_ — Ranking calculation for display
  - fields: member_id, total_points, streak_bonus, rank

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Create/edit family
- Manage habits and defaults
- Configure daily reminders
- View weekly summaries
- See full leaderboard

## Notifications

- Weekly summary to ADMIN_CHAT_ID every Sunday
- Alert for members with 3+ missed days

## Permissions & privacy

- Members identified by device session only
- No personal data stored beyond habit logs
- Parent has full control over family data

## Edge cases

- Member logs habits for multiple days retroactively
- Parent leaves family group
- Conflicting session IDs from shared devices

## Required tests

- End-to-end family creation flow
- Leaderboard updates after logging
- Weekly summary delivery to admin
- Reminder suppression when disabled

## Assumptions

- Parent is the sole family administrator
- Device-based identity works for target audience
- Default habits meet basic needs
