# Music Club

A multi-tenant Discord bot for running a "book club for music" — DJ rotation,
manual cadence, discussion in threads. Built on Cloudflare Workers + D1.

See [`DESIGN.md`](./DESIGN.md) for the design and [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)
for the staged build. **All five stages are implemented:**
`/ping`, `/setup`, `/rotation`, `/pick`, `/pass`, `/nowplaying`, `/discuss`,
`/wrap`, `/history`, and `/club reset`, plus song.link link enrichment (via a
Queue) and a daily listening-window reminder (via cron). Run `bun run register`
after changing commands and `bun run deploy` after changing code.

### Queue (link enrichment)

`/pick` enqueues a job that fetches a [song.link](https://odesli.co/) universal
URL and drops it in the discussion thread. Create the queue once:

```sh
bun run queue:create        # wrangler queues create music-club-enrich
```

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
bun run register     # register the /ping slash command
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

## Add the bot to a server

Use an OAuth2 install link with the `bot` and `applications.commands` scopes
(Discord Developer Portal → OAuth2 → URL Generator). Each server that adds the
bot becomes its own independent club (scoped by `guild_id`).

## Layout

```
src/
  index.ts            Hono app: /interactions endpoint, PING handshake, command router
  discord/
    verify.ts         Ed25519 signature verification (native Web Crypto)
    types.ts          Interaction/response type constants + payload shapes
  commands/
    definitions.ts    Slash command definitions (Stage 1: /ping)
    register.ts       One-off script to register commands with Discord
migrations/
  0001_init.sql       clubs / members / rounds schema
```
