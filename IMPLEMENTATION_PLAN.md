# Implementation Plan — Music Club Discord bot

Stack: Cloudflare Workers (Hono) + D1 + Queues, managed with Bun. Multi-tenant
Discord bot driven by HTTP interactions. See `DESIGN.md` for the full design.

## Stage 1: Interaction endpoint skeleton

**Goal**: A deployed Worker that Discord accepts as a verified interactions
endpoint and answers a trivial command.
**Success Criteria**:
- `POST /interactions` verifies the Ed25519 signature (WebCrypto) and rejects bad
  signatures with 401.
- Responds to Discord's `PING` with `PONG`.
- A `/ping` slash command (guild-scoped for dev) replies "pong".
- `wrangler.jsonc` with secrets (`DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`,
  `DISCORD_APP_ID`) and a command-registration script.
**Tests**:
- Valid signature → 200; tampered body → 401.
- PING payload → `{ type: 1 }`.
**Status**: Complete (typecheck + Worker bundle verified)

## Stage 2: Club bootstrap + rotation

**Goal**: Per-guild club state with a working DJ rotation.
**Success Criteria**:
- D1 schema for `clubs`, `members` (migrations).
- Lazy club init on first command for a guild; members upserted on interaction.
- `/setup` (admin-gated via `default_member_permissions`) sets announce channel,
  admin role, default listen-window.
- `/rotation` shows order and current DJ.
**Tests**:
- First command in a fresh guild creates exactly one `clubs` row.
- New member's first interaction creates one `members` row (idempotent on repeat).
- Non-admin `/setup` is rejected.
**Status**: Complete (rotation/bootstrap SQL verified against SQLite; per-guild
isolation confirmed)

## Stage 3: Core loop — pick / now playing / pass

**Goal**: A DJ can pick, the group can see it, and a DJ can pass.
**Success Criteria**:
- `/pick` creates a `rounds` row (status `listening`), posts an announcement
  embed to the configured channel, and auto-creates a discussion thread
  (`thread_id` stored).
- Only the current DJ may `/pick` or `/pass`.
- `/pass` advances rotation, increments `passes_count`, creates no round.
- `/nowplaying` returns the active round.
**Tests**:
- Non-DJ `/pick` rejected.
- `/pass` advances `current_dj_id` to the next active member by `rotation_pos`.
- `/pick` with no configured announce channel returns a helpful error.
**Status**: Complete (typecheck + bundle verified; round creation, the
one-active-per-guild constraint, and rotation advance/wrap verified against
SQLite). Note: `picks_count` is incremented at `/pick` time, so `/wrap` (Stage 4)
must NOT increment it again.

## Stage 4: Close, advance, history

**Goal**: Rounds can be moved through and looked back on.
**Success Criteria**:
- `/discuss` flips `listening` → `discussing` (DJ or admin).
- `/wrap` sets `archived` + `wrapped_at` and advances rotation to the next DJ.
  (`picks_count` is already incremented at `/pick` time — do not double-count.)
- `/history` lists past rounds (paged).
- `/club reset` (admin) deletes the guild's data.
**Tests**:
- `/wrap` advances rotation and archives exactly the active round.
- `/history` in a guild only returns that guild's rounds (tenancy isolation).
**Status**: Complete (typecheck + bundle verified; discuss→wrap→history→reset
flow verified against SQLite, including archived-only history filtering)

## Stage 5: Polish — enrichment, reminders, install

**Goal**: Production niceties for a public, multi-tenant bot.
**Success Criteria**:
- Submitted links enriched via Songlink/Odesli through a **Queue**;
  `songlink_url` populated, announcement updated.
- Optional daily **cron** posts soft listening-window nudges.
- Global command registration for production.
- Documented "Add to Server" OAuth2 install link.
- Discord REST rate-limit handling on outbound posts.
**Tests**:
- Enrichment failure leaves the round usable (graceful degradation).
- Reminder fires only for rounds past `listen_by` still in `listening`.
**Status**: Complete (typecheck + bundle with Queue binding verified; cross-guild
reminder query + once-only marking verified against SQLite). song.link enrichment
runs via the `ENRICH_QUEUE` consumer; reminders via a daily cron (17:00 UTC).

---

**All five stages complete.** Remaining work is operational, not code: create the
queue (`bun run queue:create`), apply migrations, register commands, deploy. The
live HTTP/signature round-trip was confirmed earlier; the queue consumer and cron
are best verified against the deployed Worker (tail logs with `wrangler tail`).
