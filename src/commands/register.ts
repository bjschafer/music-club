// Registers slash commands with Discord. Run with `npm run register`.
//
// This is a one-off Node script (not part of the Worker). It reads credentials
// from the environment, falling back to `.dev.vars` for convenience.
//
//   - Dev:  set DISCORD_DEV_GUILD_ID to register to a single test server
//           instantly.
//   - Prod: leave it unset to register GLOBAL commands (propagation can take
//           up to ~1 hour).

import { readFileSync } from "node:fs";
import { commands } from "./definitions.js";

// Load .dev.vars (KEY=value lines) into process.env if not already set.
function loadDevVars(): void {
  try {
    const text = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .dev.vars — rely on the real environment.
  }
}

loadDevVars();

const appId = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const devGuild = process.env.DISCORD_DEV_GUILD_ID;

if (!appId || !token) {
  throw new Error("DISCORD_APP_ID and DISCORD_BOT_TOKEN must be set (env or .dev.vars)");
}

const url = devGuild
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${devGuild}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const res = await fetch(url, {
  method: "PUT", // PUT bulk-overwrites the full command set.
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`Registration failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

const scope = devGuild ? `guild ${devGuild}` : "globally";
console.log(`Registered ${commands.length} command(s) ${scope}.`);
