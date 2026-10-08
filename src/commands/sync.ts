// Keeps Discord's registered slash commands in step with `definitions.ts`
// without a manual `bun run register`. The Worker already holds the bot token,
// so after a deploy the first interaction notices the definitions changed
// (by hash, stored in D1) and bulk-overwrites the command set.

import { commands } from "./definitions";
import { getMeta, setMeta } from "../store";
import type { DiscordRest } from "../discord/rest";

const HASH_KEY = "commands_hash";

// Once an isolate has confirmed the commands are current, skip the D1 read for
// the rest of its life — definitions can't change without a redeploy.
let synced = false;

async function hashCommands(): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(commands));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// devGuildId scopes registration to one guild (instant, and keeps local dev
// from overwriting the global commands production uses).
export async function syncCommands(
  db: D1Database,
  rest: DiscordRest,
  devGuildId?: string,
): Promise<void> {
  if (synced) return;
  const hash = await hashCommands();
  const key = devGuildId ? `${HASH_KEY}:${devGuildId}` : HASH_KEY;
  if ((await getMeta(db, key)) !== hash) {
    await rest.overwriteCommands(commands, devGuildId);
    await setMeta(db, key, hash);
    console.log(`Synced ${commands.length} slash command(s) to Discord (${devGuildId ?? "global"}).`);
  }
  synced = true;
}
