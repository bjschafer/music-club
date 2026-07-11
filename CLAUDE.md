# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
bun run dev              # local Worker at http://localhost:8787
bun run deploy           # deploy to Cloudflare manually (skip if pushing to main)
bun run register         # register/update slash commands with Discord
bun run typecheck        # tsc --noEmit (no build output, just type errors)

bun run db:migrate:local   # apply new migrations to local D1
bun run db:migrate:remote  # apply new migrations to production D1
```

**Deploys are automatic** — pushing to `main` triggers a Cloudflare Workers build and deploy via the GitHub integration. `bun run deploy` is available for manual/out-of-band deploys only.

**After changing slash command definitions** (`src/commands/definitions.ts`), always run `bun run register`.

## Architecture

This is a **multi-tenant Discord bot** deployed as a Cloudflare Worker. Each Discord server that adds the bot gets an independent club, partitioned by `guild_id`. There is no gateway connection — everything is driven by Discord's HTTP webhook interactions.

### Request flow

1. Discord POSTs every slash command interaction to `/interactions`.
2. `src/index.ts` verifies the Ed25519 signature (`src/discord/verify.ts`) against the raw body before parsing.
3. `handleCommand()` routes by `interaction.data.name` to individual handlers.
4. Commands that need to post to Discord (not just reply to the interaction) use `DiscordRest` (`src/discord/rest.ts`) with the bot token.

### Key modules

| File | Purpose |
|---|---|
| `src/index.ts` | Hono app, all command handlers, cron handler |
| `src/store.ts` | All D1 queries, types for `Club`, `Member`, `Round` |
| `src/discord/verify.ts` | Ed25519 signature verification via native WebCrypto |
| `src/discord/rest.ts` | Minimal Discord REST client (post message, create thread, edit deferred response) |
| `src/discord/types.ts` | Interaction/response type constants, helper functions (`interactionUser`, `getOption`, etc.) |
| `src/commands/definitions.ts` | Slash command schemas registered with Discord |
| `src/commands/register.ts` | One-off script that calls Discord's API to register commands |
| `migrations/` | D1 SQL migrations applied in order |

### Deferred responses

`/pick` exceeds Discord's 3-second response window because it posts an announcement, creates a thread, and fetches search links. The pattern is:
1. Return `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` immediately
2. Do the real work in `c.executionCtx.waitUntil(...)`
3. Call `rest.editOriginalResponse(token, ...)` when done

### Data model

Three tables, all scoped by `guild_id`:
- `clubs` — one row per server; `current_dj_id` points to the on-deck member
- `members` — DJ rotation order via `rotation_pos`; soft-deleted with `active = 0`
- `rounds` — pick lifecycle: `listening → archived`; a partial unique index enforces at most one non-archived round per guild

`touchClub()` lazily creates a club row on first command use (no "bot added" gateway event available).

Round lifecycle (`/pick` opens the discussion thread immediately — there is no
separate `/discuss` step; the old `discussing` status was dropped in migration
`0004`):
```
/pick ──► LISTENING ──/wrap──► ARCHIVED
          (thread open;         (rotation advances
           listening window)     → next DJ on deck)

/pass at your turn → rotation advances, no round created
```

A LISTENING round is wrapped one of two ways:
- **Manually** via `/wrap` (the DJ or an admin).
- **Automatically** by the cron once `listen_by` has fully elapsed — same archive
  + rotation-advance as a manual wrap. Extend the window with `/extend` to defer it.

### Not planned

These were explicitly deferred and are not missing by accident:
- **Ratings / Hall of Fame** — `rounds` keeps full history; this would be a pure additive read query
- Suggestion box (a stuck DJ just `/pass`es)
- AI discussion prompts / end-of-round summaries
- Read-only web view for history

### Secrets / environment

Secrets are **not** in `wrangler.jsonc`. Locally: `.dev.vars`. Production: `wrangler secret put`.

| Name | Purpose |
|---|---|
| `DISCORD_PUBLIC_KEY` | Ed25519 public key for request verification |
| `DISCORD_BOT_TOKEN` | Bot token for REST API calls |
| `DISCORD_APP_ID` | Application ID for editing deferred responses |
| `DISCORD_DEV_GUILD_ID` | (optional, local only) Guild for instant command registration |

### Local dev notes

Discord must reach the Worker over HTTPS. Expose `localhost:8787` with a tunnel:
```sh
cloudflared tunnel --url http://localhost:8787
```
Then set the Discord app's **Interactions Endpoint URL** to `https://<tunnel>/interactions`. Discord sends a signed PING on save to verify the endpoint.

### Cron

`wrangler.jsonc` schedules `handleScheduled` daily at 17:00 UTC. Each run, across all guilds:
1. **Auto-wrap** listening rounds whose `listen_by` has fully elapsed — archives the round, advances the rotation, and posts an "auto-wrapped, next DJ on deck" message to the announce channel (falling back to the thread).
2. **Remind** on listening rounds whose window ends within the next 24 hours (but hasn't elapsed yet) by posting a nudge to the discussion thread, then sets `reminded_at` so it doesn't fire again.
