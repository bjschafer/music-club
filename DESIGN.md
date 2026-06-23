# Music Club — Design

A "book club for music." Members take turns being the DJ, picking a song or
album (the kind that rewards real listening — epic-length tracks, concept
albums), and the group listens on their own time, then discusses. Runs as a
multi-tenant Discord bot on Cloudflare Workers.

## Decisions (and why)

| Decision | Choice | Why |
|---|---|---|
| Interface | **Discord-native** | Slash commands + buttons arrive over HTTP webhooks, which fit Workers perfectly (no persistent gateway). Discussion happens in native threads — notifications, embeds, replies all for free. |
| Cadence | **Manual / on-demand** | Commands drive every phase. No clock to fight, no scheduled-transition machinery. A friend group sets its own pace. |
| Selection | **DJ rotation** with a guilt-free `pass` | Guarantees variety and gives everyone's taste airtime. No tie-breaks, no "nothing won." Pure listeners can pass forever — that's a valid way to be in the club. |
| Tenancy | **Multi-tenant** (hosted, also self-hostable) | One bot any server can add. Each guild is an independent club, partitioned by `guild_id`. |

### Explicitly deferred (not in v1)

- **Borda / ranked-choice rating + Hall of Fame.** The `rounds` table preserves
  the full historical record (who picked what, when, the note, the thread), so
  any future rating/leaderboard/taste feature is a pure additive read — no
  migration, no lost data.
- **Suggestion box.** A blanking DJ just passes.
- AI discussion prompts / end-of-round thread summaries (Workers AI).
- Read-only web view for history.

## Lifecycle

```
  /pick  ──────►  LISTENING  ──/discuss──►  DISCUSSING  ──/wrap──►  ARCHIVED
 (DJ posts pick,    (window to             (thread is live;        (advance rotation
  thread auto-made)  actually listen)       talk it out)            → next DJ on deck)

  /pass at your turn → rotation advances, no round created
```

Every transition is a command someone runs. An optional daily cron sends *soft*
nudges ("🎧 still in listening — ready to dig in?") but never forces a transition.

## Commands

| Command | Who | Does |
|---|---|---|
| `/pick <link> [why] [listen-by]` | current DJ | Creates the round, posts an announcement embed, auto-creates a discussion thread |
| `/pass` | current DJ | Forfeits this turn, advances rotation (no round) |
| `/nowplaying` | anyone | Current pick, DJ, listen-by, thread link |
| `/rotation` | anyone | Who's on deck and the upcoming order |
| `/discuss` | DJ or admin | Flip listening → discussing |
| `/wrap` | DJ or admin | Close the round, advance rotation to next DJ |
| `/history` | anyone | Past picks |
| `/setup` | admin | Configure announcement channel, admin role, default listen-window |
| `/club reset` | admin | Delete this server's club data |

**Implementation notes**

- Votes/selections (if ever added) use **button & select-menu components** —
  they arrive via the interaction webhook. Emoji reactions require a gateway
  connection Workers won't hold, so they're avoided.
- Proactive posts (announcements, nudges) go out via the **Discord REST API**
  with a bot token over plain `fetch` — no persistent connection.
- Admin commands gate on Discord's `default_member_permissions` (e.g. *Manage
  Server*) plus an optional configurable admin role — never a hardcoded owner.

## Multi-tenancy

- One bot app, installed to many servers. Every interaction carries `guild_id`;
  all data is partitioned by it. Each guild = one independent club.
- **Lazy init:** without a gateway there's no "bot added" event, so a guild's
  club row is created on its first command (or via `/setup`).
- **Global command registration** (register once for the app). Guild-scoped
  registration is used only during local dev for instant iteration.
- **Install link:** OAuth2 URL with `bot` + `applications.commands` scopes.
- **Hosting model:** operated as a hosted bot (recommended) *and* self-hostable
  from the same repo (others deploy their own Worker + bot token).
- **Data hygiene:** respect Discord REST rate limits (Queue for outbound posts);
  `/club reset` for deletion.

## Data model (D1)

```
clubs        guild_id PK, name, announce_channel_id, admin_role_id,
             current_dj_id, default_listen_days, created_at

members      id PK, guild_id, discord_id, display_name, rotation_pos,
             active, picks_count, passes_count
             UNIQUE(guild_id, discord_id)

rounds       id PK, guild_id, dj_id, title, artist, type(song|album),
             url, songlink_url, note, listen_by, status(listening|discussing|archived),
             thread_id, created_at, wrapped_at
```

Rotation is `clubs.current_dj_id` + `members.rotation_pos`. Advancing is a single
transactional `UPDATE` — no concurrency hazard, which is why no Durable Object is
needed.

## Architecture (Cloudflare)

| Concern | Primitive |
|---|---|
| Interaction endpoint + REST callbacks | **Worker** (Hono router) |
| Ed25519 signature verification | **WebCrypto** (native) |
| Clubs, members, rounds | **D1** |
| Async link enrichment (Songlink/Odesli) | **Queues** |
| Soft listening reminders | **Cron Trigger** (optional) |
| Discussion prompts / summaries | **Workers AI** (deferred) |

No Durable Object, no required cron for the core loop.

## Open / operational notes

- Songlink (Odesli) enrichment turns any platform link into a universal one so
  members on Spotify / Apple / YouTube / Bandcamp can all play the pick.
- Removal-on-kick can't be observed without a gateway; rely on `/club reset` and
  optional lazy expiry of stale guilds.
