// D1 access layer for clubs and members.
// Every query is scoped by guild_id — one independent club per Discord server.

import type { DiscordInteraction } from "./discord/types";

export interface Club {
  guild_id: string;
  name: string;
  announce_channel_id: string | null;
  admin_role_id: string | null;
  current_dj_id: number | null;
  default_listen_days: number;
  created_at: number;
}

export interface Member {
  id: number;
  guild_id: string;
  discord_id: string;
  display_name: string;
  rotation_pos: number;
  active: number;
  picks_count: number;
  passes_count: number;
  created_at: number;
}

function displayNameOf(i: DiscordInteraction): string {
  const u = i.member?.user ?? i.user;
  return u?.global_name ?? u?.username ?? "Unknown";
}

// Lazily create this guild's club. Without a gateway connection there's no
// "bot added" event, so first command use bootstraps the club.
export async function touchClub(db: D1Database, guildId: string): Promise<Club> {
  await db
    .prepare("INSERT INTO clubs (guild_id) VALUES (?) ON CONFLICT (guild_id) DO NOTHING")
    .bind(guildId)
    .run();
  return (await getClub(db, guildId))!;
}

// Look up an active member by their Discord user ID without creating one.
export function getMemberByDiscordId(
  db: D1Database,
  guildId: string,
  discordId: string,
): Promise<Member | null> {
  return db
    .prepare("SELECT * FROM members WHERE guild_id = ? AND discord_id = ? AND active = 1")
    .bind(guildId, discordId)
    .first<Member>();
}

// Explicitly add (or reactivate) a member.
// result: "already_active" = no change; "rejoined" = reactivated; "joined" = brand new.
export async function joinRotation(
  db: D1Database,
  interaction: DiscordInteraction,
): Promise<{ member: Member; result: "already_active" | "rejoined" | "joined" }> {
  const guildId = interaction.guild_id!;
  const user = (interaction.member?.user ?? interaction.user)!;
  const name = displayNameOf(interaction);

  const existing = await db
    .prepare("SELECT * FROM members WHERE guild_id = ? AND discord_id = ?")
    .bind(guildId, user.id)
    .first<Member>();

  if (existing?.active) {
    return { member: existing, result: "already_active" };
  }

  let member: Member;
  if (existing) {
    // Reactivate at the end of the current rotation order.
    const tail = await db
      .prepare("SELECT COALESCE(MAX(rotation_pos), -1) + 1 AS next FROM members WHERE guild_id = ?")
      .bind(guildId)
      .first<{ next: number }>();
    member = (await db
      .prepare("UPDATE members SET active = 1, rotation_pos = ?, display_name = ? WHERE id = ? RETURNING *")
      .bind(tail!.next, name, existing.id)
      .first<Member>())!;
  } else {
    member = (await db
      .prepare(
        `INSERT INTO members (guild_id, discord_id, display_name, rotation_pos)
         VALUES (?1, ?2, ?3,
                 (SELECT COALESCE(MAX(rotation_pos), -1) + 1 FROM members WHERE guild_id = ?1))
         RETURNING *`,
      )
      .bind(guildId, user.id, name)
      .first<Member>())!;
  }

  // First active member in the club becomes the DJ on deck.
  await db
    .prepare("UPDATE clubs SET current_dj_id = ? WHERE guild_id = ? AND current_dj_id IS NULL")
    .bind(member.id, guildId)
    .run();

  return { member, result: existing ? "rejoined" : "joined" };
}

// Remove a member from the active rotation. If they were on deck, advances to
// the next active member (or clears the pointer if the rotation is now empty).
// Returns the new on-deck member, or null if the rotation is now empty.
export async function leaveRotation(
  db: D1Database,
  guildId: string,
  member: Member,
): Promise<Member | null> {
  await db.prepare("UPDATE members SET active = 0 WHERE id = ?").bind(member.id).run();

  const club = await getClub(db, guildId);
  if (club?.current_dj_id !== member.id) return null;

  // They were on deck — hand off to next active member, if any.
  const next = await db
    .prepare(
      "SELECT * FROM members WHERE guild_id = ? AND active = 1 ORDER BY rotation_pos LIMIT 1",
    )
    .bind(guildId)
    .first<Member>();

  if (!next) {
    await db
      .prepare("UPDATE clubs SET current_dj_id = NULL WHERE guild_id = ?")
      .bind(guildId)
      .run();
    return null;
  }

  return advanceRotation(db, guildId, member);
}

export function getClub(db: D1Database, guildId: string): Promise<Club | null> {
  return db.prepare("SELECT * FROM clubs WHERE guild_id = ?").bind(guildId).first<Club>();
}

export async function listMembers(db: D1Database, guildId: string): Promise<Member[]> {
  const { results } = await db
    .prepare("SELECT * FROM members WHERE guild_id = ? AND active = 1 ORDER BY rotation_pos")
    .bind(guildId)
    .all<Member>();
  return results;
}

export interface ClubConfig {
  announce_channel_id?: string;
  admin_role_id?: string;
  default_listen_days?: number;
}

// Update only the provided fields. Returns true if anything was set.
export async function updateClubConfig(
  db: D1Database,
  guildId: string,
  config: ClubConfig,
): Promise<boolean> {
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (config.announce_channel_id !== undefined) {
    sets.push(`announce_channel_id = ?${sets.length + 1}`);
    values.push(config.announce_channel_id);
  }
  if (config.admin_role_id !== undefined) {
    sets.push(`admin_role_id = ?${sets.length + 1}`);
    values.push(config.admin_role_id);
  }
  if (config.default_listen_days !== undefined) {
    sets.push(`default_listen_days = ?${sets.length + 1}`);
    values.push(config.default_listen_days);
  }
  if (sets.length === 0) return false;

  values.push(guildId);
  await db
    .prepare(`UPDATE clubs SET ${sets.join(", ")} WHERE guild_id = ?${values.length}`)
    .bind(...values)
    .run();
  return true;
}

export interface Round {
  id: number;
  guild_id: string;
  dj_id: number;
  title: string;
  artist: string | null;
  type: string;
  url: string;
  songlink_url: string | null;
  note: string | null;
  listen_by: number | null;
  status: string;
  thread_id: string | null;
  created_at: number;
  wrapped_at: number | null;
  reminded_at: number | null;
}

export interface RoundWithDj extends Round {
  dj_name: string;
}

export interface NewRound {
  guild_id: string;
  dj_id: number;
  title: string;
  artist: string | null;
  type: string;
  url: string;
  note: string | null;
  listen_by: number | null;
  thread_id: string | null;
}

export async function createRound(db: D1Database, r: NewRound): Promise<Round> {
  const row = await db
    .prepare(
      `INSERT INTO rounds (guild_id, dj_id, title, artist, type, url, note, listen_by, thread_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(r.guild_id, r.dj_id, r.title, r.artist, r.type, r.url, r.note, r.listen_by, r.thread_id)
    .first<Round>();
  return row!;
}

// The single non-archived round for a guild (the DB enforces at most one).
export function getActiveRound(
  db: D1Database,
  guildId: string,
): Promise<RoundWithDj | null> {
  return db
    .prepare(
      `SELECT r.*, m.display_name AS dj_name
       FROM rounds r JOIN members m ON m.id = r.dj_id
       WHERE r.guild_id = ? AND r.status IN ('listening', 'discussing')
       LIMIT 1`,
    )
    .bind(guildId)
    .first<RoundWithDj>();
}

export function getMemberById(db: D1Database, id: number): Promise<Member | null> {
  return db.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<Member>();
}

export function getRoundById(db: D1Database, id: number): Promise<Round | null> {
  return db.prepare("SELECT * FROM rounds WHERE id = ?").bind(id).first<Round>();
}

export async function setSonglink(
  db: D1Database,
  roundId: number,
  url: string,
): Promise<void> {
  await db.prepare("UPDATE rounds SET songlink_url = ? WHERE id = ?").bind(url, roundId).run();
}

// Listening rounds whose window ends at or before `soon` and haven't been
// reminded yet. Spans all guilds — the cron iterates every club at once.
export async function listRoundsNeedingReminder(
  db: D1Database,
  soon: number,
): Promise<Round[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM rounds
       WHERE status = 'listening' AND reminded_at IS NULL
         AND listen_by IS NOT NULL AND listen_by <= ?
       ORDER BY listen_by`,
    )
    .bind(soon)
    .all<Round>();
  return results;
}

export async function markReminded(
  db: D1Database,
  roundId: number,
  ts: number,
): Promise<void> {
  await db.prepare("UPDATE rounds SET reminded_at = ? WHERE id = ?").bind(ts, roundId).run();
}

export async function incrementPasses(db: D1Database, memberId: number): Promise<void> {
  await db
    .prepare("UPDATE members SET passes_count = passes_count + 1 WHERE id = ?")
    .bind(memberId)
    .run();
}

export async function incrementPicks(db: D1Database, memberId: number): Promise<void> {
  await db
    .prepare("UPDATE members SET picks_count = picks_count + 1 WHERE id = ?")
    .bind(memberId)
    .run();
}

// Move the on-deck DJ to the next active member by rotation_pos, wrapping around.
// Returns the new current DJ (may be the same member if they're the only one).
export async function advanceRotation(
  db: D1Database,
  guildId: string,
  current: Member,
): Promise<Member> {
  let next = await db
    .prepare(
      "SELECT * FROM members WHERE guild_id = ? AND active = 1 AND rotation_pos > ? ORDER BY rotation_pos LIMIT 1",
    )
    .bind(guildId, current.rotation_pos)
    .first<Member>();

  if (!next) {
    next = await db
      .prepare("SELECT * FROM members WHERE guild_id = ? AND active = 1 ORDER BY rotation_pos LIMIT 1")
      .bind(guildId)
      .first<Member>();
  }

  await db
    .prepare("UPDATE clubs SET current_dj_id = ? WHERE guild_id = ?")
    .bind(next!.id, guildId)
    .run();
  return next!;
}

// Flip the active listening round to discussing. No-op if none is listening.
export async function markDiscussing(db: D1Database, guildId: string): Promise<void> {
  await db
    .prepare("UPDATE rounds SET status = 'discussing' WHERE guild_id = ? AND status = 'listening'")
    .bind(guildId)
    .run();
}

// Archive the active round (listening or discussing).
export async function wrapActiveRound(
  db: D1Database,
  guildId: string,
  wrappedAt: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE rounds SET status = 'archived', wrapped_at = ? WHERE guild_id = ? AND status IN ('listening', 'discussing')",
    )
    .bind(wrappedAt, guildId)
    .run();
}

export async function listArchivedRounds(
  db: D1Database,
  guildId: string,
  limit: number,
): Promise<RoundWithDj[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, m.display_name AS dj_name
       FROM rounds r JOIN members m ON m.id = r.dj_id
       WHERE r.guild_id = ? AND r.status = 'archived'
       ORDER BY COALESCE(r.wrapped_at, r.created_at) DESC
       LIMIT ?`,
    )
    .bind(guildId, limit)
    .all<RoundWithDj>();
  return results;
}

export async function clubCounts(
  db: D1Database,
  guildId: string,
): Promise<{ members: number; rounds: number }> {
  const m = await db
    .prepare("SELECT COUNT(*) AS c FROM members WHERE guild_id = ?")
    .bind(guildId)
    .first<{ c: number }>();
  const r = await db
    .prepare("SELECT COUNT(*) AS c FROM rounds WHERE guild_id = ?")
    .bind(guildId)
    .first<{ c: number }>();
  return { members: m?.c ?? 0, rounds: r?.c ?? 0 };
}

// Delete all of a guild's club data. Ordered rounds → members → clubs so it holds
// whether or not foreign-key enforcement is on.
export async function resetClub(db: D1Database, guildId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM rounds WHERE guild_id = ?").bind(guildId),
    db.prepare("DELETE FROM members WHERE guild_id = ?").bind(guildId),
    db.prepare("DELETE FROM clubs WHERE guild_id = ?").bind(guildId),
  ]);
}
