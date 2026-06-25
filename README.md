# Music Club

A multi-tenant Discord bot for running a "book club for music" — DJ rotation,
manual cadence, discussion in threads. Built on Cloudflare Workers + D1.

[![Add to Discord](https://img.shields.io/badge/Add%20to%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=1518811119266037770&permissions=309237664768&scope=bot+applications.commands)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bjschafer/music-club)

## Commands

| Command | Who | Description |
|---|---|---|
| `/ping` | anyone | Check that the bot is alive |
| `/join` | anyone | Join the DJ rotation |
| `/leave` | anyone | Remove yourself from the rotation |
| `/rotation` | anyone | Show the rotation and who's on deck |
| `/pick` | current DJ | Post a pick (opens an announcement + thread) |
| `/extend` | DJ or admin | Add days to the current listening window |
| `/pass` | current DJ | Skip your turn; rotation advances |
| `/nowplaying` | anyone | Show the current pick and thread link |
| `/wrap` | DJ or admin | Archive the pick and pass the baton |
| `/history` | anyone | Show recently wrapped picks |
| `/setup` | admin | Configure announce channel, admin role, default listen days |
| `/club reset` | admin | Wipe all club data for this server |

### Permissions for `/pick`

`/pick` posts an announcement and opens a thread, so the bot needs these
permissions **in the announcement channel**: View Channel, Send Messages, Embed
Links, Create Public Threads, Send Messages in Threads. Re-invite via the OAuth2
URL Generator with those boxes ticked (or grant the bot a role that has them),
then set the channel with `/setup announce_channel:#your-channel`.

## One-time setup

1. **Install deps**
   ```sh
   bun install
   ```

2. **Create the Discord app** at <https://discord.com/developers/applications>.
   From the app, collect:
   - **Application ID** → `DISCORD_APP_ID`
   - **Public Key** (General Information) → `DISCORD_PUBLIC_KEY`
   - **Bot → Token** → `DISCORD_BOT_TOKEN`

3. **Local secrets**
   ```sh
   cp .dev.vars.example .dev.vars   # then fill in the three values
   ```

4. **Create the database** and paste the printed `database_id` into `wrangler.jsonc`
   ```sh
   bun run db:create
   bun run db:migrate:local
   ```

## Run it

```sh
bun run dev          # local Worker at http://localhost:8787
bun run register     # register slash commands with Discord
```

Slash commands are sent to Discord, not your Worker, so registration is a
separate step. With `DISCORD_DEV_GUILD_ID` set in `.dev.vars`, commands appear in
that server instantly; without it they register globally (up to ~1h to propagate).

### Point Discord at your endpoint

Discord must reach your Worker over HTTPS to verify it. In dev, expose
`http://localhost:8787` with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`),
then set the app's **Interactions Endpoint URL** to `https://<tunnel>/interactions`.
Discord sends a signed PING on save — if verification works, it's accepted.

## Deploy

```sh
wrangler secret put DISCORD_APP_ID
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_BOT_TOKEN
bun run db:migrate:remote
bun run deploy
```

Set the production **Interactions Endpoint URL** to `https://<your-worker>.workers.dev/interactions`.

Deploys also happen automatically on push to `main` via the Cloudflare GitHub integration.

## Add the bot to a server

Each server that adds the bot gets its own independent club (scoped by `guild_id`). After adding, run `/setup` to configure your announcement channel.

### Round lifecycle

```
/pick ──► LISTENING ──/wrap──► ARCHIVED
          (window to           (rotation advances
           listen)              → next DJ on deck)

/pass at your turn → rotation advances, no round created
/extend at any point → adds days to the listening window
```

A partial unique index enforces at most one non-archived round per guild.

### Cron

`wrangler.jsonc` schedules a daily job at 17:00 UTC. It scans all guilds for
listening rounds whose window ends within the next 24 hours, posts a nudge to
the discussion thread, and sets `reminded_at` so it doesn't fire again.
