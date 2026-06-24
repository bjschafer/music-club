import { Hono, type Context } from "hono";
import { verifyDiscordRequest } from "./discord/verify";
import {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  interactionUser,
  hasManageGuild,
  getOption,
  type DiscordInteraction,
  type DiscordInteractionOption,
} from "./discord/types";
import { DiscordRest } from "./discord/rest";
import {
  touchClub,
  getMemberByDiscordId,
  joinRotation,
  leaveRotation,
  getClub,
  listMembers,
  updateClubConfig,
  getActiveRound,
  getMemberById,
  createRound,
  incrementPasses,
  incrementPicks,
  advanceRotation,
  markDiscussing,
  wrapActiveRound,
  listArchivedRounds,
  clubCounts,
  resetClub,
  listRoundsNeedingReminder,
  markReminded,
  type Club,
  type ClubConfig,
  type Member,
  type NewRound,
} from "./store";

export interface Env {
  DB: D1Database;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APP_ID: string;
}

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

// Liveness check (useful for a quick browser hit; Discord never calls this).
app.get("/", (c) => c.text("🎶 Music Club bot is running"));

// Discord posts every interaction here. We must verify the signature against the
// RAW body before parsing, then handle the PING handshake and slash commands.
app.post("/interactions", async (c) => {
  const signature = c.req.header("X-Signature-Ed25519") ?? null;
  const timestamp = c.req.header("X-Signature-Timestamp") ?? null;
  const rawBody = await c.req.text();

  const valid = await verifyDiscordRequest(
    rawBody,
    signature,
    timestamp,
    c.env.DISCORD_PUBLIC_KEY,
  );
  if (!valid) {
    return c.text("invalid request signature", 401);
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  // Discord's verification handshake — must echo PONG.
  if (interaction.type === InteractionType.PING) {
    return c.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    return handleCommand(c, interaction);
  }

  // Unhandled interaction type — acknowledge harmlessly.
  return c.json({ type: InteractionResponseType.PONG });
});

async function handleCommand(c: AppContext, interaction: DiscordInteraction) {
  const name = interaction.data?.name;

  if (name === "ping") {
    const who = interactionUser(interaction)?.global_name ?? "there";
    return reply(c, `🎶 pong — ready to spin some records, ${who}.`, true);
  }

  // Every other command operates on a guild's club.
  if (!interaction.guild_id) {
    return reply(c, "Use this inside a server — Music Club runs per server.", true);
  }

  const club = await touchClub(c.env.DB, interaction.guild_id);

  switch (name) {
    case "join":
      return handleJoin(c, interaction);
    case "leave":
      return handleLeave(c, interaction);
    case "rotation":
      return handleRotation(c, interaction, club);
    case "setup":
      return handleSetup(c, interaction, club);
    case "nowplaying":
      return handleNowPlaying(c, interaction, club);
    case "history":
      return handleHistory(c, interaction, club);
    case "club":
      return handleClub(c, interaction, club);
    case "pick":
    case "pass":
    case "discuss":
    case "wrap": {
      const user = (interaction.member?.user ?? interaction.user)!;
      const member = await getMemberByDiscordId(c.env.DB, interaction.guild_id, user.id);
      if (!member) return reply(c, "You're not in the rotation yet — use `/join` to join.", true);
      if (name === "pick") return handlePick(c, interaction, club, member);
      if (name === "pass") return handlePass(c, interaction, club, member);
      if (name === "discuss") return handleDiscuss(c, interaction, club, member);
      return handleWrap(c, interaction, club, member);
    }
    default:
      return reply(c, `Unknown command: \`${name}\``, true);
  }
}

async function handleJoin(c: AppContext, interaction: DiscordInteraction) {
  const { member, result } = await joinRotation(c.env.DB, interaction);
  if (result === "already_active") {
    return reply(c, `You're already in the rotation, **${member.display_name}**.`, true);
  }
  if (result === "rejoined") {
    return reply(c, `🎧 Welcome back, **${member.display_name}**! You're queued up at the end of the rotation.`);
  }
  const club = await getClub(c.env.DB, interaction.guild_id!);
  const isOnDeck = club?.current_dj_id === member.id;
  const msg = isOnDeck
    ? `🎧 **${member.display_name}** joined the rotation and is on deck — \`/pick\` something!`
    : `🎧 **${member.display_name}** joined the rotation! Use \`/rotation\` to see the lineup.`;
  return reply(c, msg);
}

async function handleLeave(c: AppContext, interaction: DiscordInteraction) {
  const user = (interaction.member?.user ?? interaction.user)!;
  const member = await getMemberByDiscordId(c.env.DB, interaction.guild_id!, user.id);
  if (!member) {
    return reply(c, "You're not in the rotation.", true);
  }
  const next = await leaveRotation(c.env.DB, interaction.guild_id!, member);
  const msg = next
    ? `👋 **${member.display_name}** left the rotation. <@${next.discord_id}> is now on deck.`
    : `👋 **${member.display_name}** left the rotation.`;
  return reply(c, msg);
}

async function handleRotation(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
) {
  const members = await listMembers(c.env.DB, interaction.guild_id!);
  if (members.length === 0) {
    return reply(c, "No members in the rotation yet.", true);
  }

  const lines = members.map((m) =>
    m.id === club.current_dj_id
      ? `🎧 **${m.display_name}** — on deck`
      : `• ${m.display_name}`,
  );
  return reply(c, `**${club.name} — DJ rotation**\n${lines.join("\n")}`);
}

async function handleSetup(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
) {
  if (!isAdmin(interaction, club)) {
    return reply(
      c,
      "You need **Manage Server** (or the club's admin role) to run `/setup`.",
      true,
    );
  }

  const config: ClubConfig = {};
  const channel = getOption(interaction, "announce_channel");
  const role = getOption(interaction, "admin_role");
  const days = getOption(interaction, "listen_days");
  if (channel !== undefined) config.announce_channel_id = String(channel);
  if (role !== undefined) config.admin_role_id = String(role);
  if (days !== undefined) config.default_listen_days = Number(days);

  // No options → show current settings instead of changing anything.
  if (Object.keys(config).length === 0) {
    return reply(c, renderSettings(club), true);
  }

  await updateClubConfig(c.env.DB, interaction.guild_id!, config);
  const updated = await getClub(c.env.DB, interaction.guild_id!);
  return reply(c, `✅ Settings updated.\n${renderSettings(updated!)}`, true);
}

async function handlePick(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
  member: Member,
) {
  if (member.id !== club.current_dj_id) {
    const dj = club.current_dj_id ? await getMemberById(c.env.DB, club.current_dj_id) : null;
    return reply(
      c,
      `It's not your turn — ${dj ? `**${dj.display_name}**` : "someone else"} is on deck.`,
      true,
    );
  }
  if (!club.announce_channel_id) {
    return reply(
      c,
      "No announcement channel set yet. An admin can run `/setup announce_channel:#channel`.",
      true,
    );
  }
  const existing = await getActiveRound(c.env.DB, interaction.guild_id!);
  if (existing) {
    return reply(
      c,
      `There's already a pick in progress: **${existing.title}**. Wrap it with \`/wrap\` first.`,
      true,
    );
  }

  const artist = getOption(interaction, "artist");
  const why = getOption(interaction, "why");
  const listenDays = getOption(interaction, "listen_days");

  const url = String(getOption(interaction, "url"));
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    return reply(c, "The URL must start with `http://` or `https://`.", true);
  }

  const days = listenDays !== undefined ? Number(listenDays) : club.default_listen_days;
  const listenBy = Math.floor(Date.now() / 1000) + days * 86400;

  const round: NewRound = {
    guild_id: interaction.guild_id!,
    dj_id: member.id,
    title: String(getOption(interaction, "title")),
    url,
    type: String(getOption(interaction, "type") ?? "album"),
    artist: String(artist),
    note: why !== undefined ? String(why) : null,
    listen_by: listenBy,
    thread_id: null,
  };

  const rest = new DiscordRest(c.env.DISCORD_BOT_TOKEN, c.env.DISCORD_APP_ID);
  const token = interaction.token;
  const announceChannel = club.announce_channel_id;
  const djName = member.display_name;

  // Posting, threading, and search links can exceed Discord's 3s window, so
  // acknowledge with a deferred response and finish in the background.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const message = await rest.createMessage(
          announceChannel,
          buildAnnouncement(round, djName, listenBy),
        );
        const thread = await rest.startThreadFromMessage(
          announceChannel,
          message.id,
          threadName(round.title),
        );
        await createRound(c.env.DB, { ...round, thread_id: thread.id });
        await incrementPicks(c.env.DB, member.id);
        await rest.editOriginalResponse(token, {
          content: `✅ Posted **${round.title}** — discussion in <#${thread.id}>. Listening window ends <t:${listenBy}:R>.`,
        });
        // Post search links for all major platforms — best effort, don't fail the pick.
        await postSearchLinks(rest, thread.id, round.title, String(artist)).catch(() => {});
      } catch (err) {
        const detail = err instanceof Error ? err.message : "unknown error";
        await rest
          .editOriginalResponse(token, { content: `⚠️ Couldn't post the pick: ${detail}` })
          .catch(() => {});
      }
    })(),
  );

  // Deferred + ephemeral — only the DJ sees the "thinking" indicator and result.
  return c.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: MessageFlags.EPHEMERAL },
  });
}

async function handlePass(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
  member: Member,
) {
  if (member.id !== club.current_dj_id) {
    return reply(c, "You can only pass when it's your turn.", true);
  }
  const active = await getActiveRound(c.env.DB, interaction.guild_id!);
  if (active) {
    return reply(
      c,
      "There's a pick in progress — nothing to pass. Use `/wrap` when discussion's done.",
      true,
    );
  }

  await incrementPasses(c.env.DB, member.id);
  const next = await advanceRotation(c.env.DB, interaction.guild_id!, member);

  return reply(
    c,
    next.id === member.id
      ? `⏭️ **${member.display_name}** passed — but you're the only DJ, so you're still on deck.`
      : `⏭️ **${member.display_name}** passed. <@${next.discord_id}> is on deck.`,
  );
}

async function handleNowPlaying(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
) {
  const round = await getActiveRound(c.env.DB, interaction.guild_id!);
  if (!round) {
    const dj = club.current_dj_id ? await getMemberById(c.env.DB, club.current_dj_id) : null;
    return reply(
      c,
      `Nothing playing right now.${dj ? ` **${dj.display_name}** is on deck — \`/pick\` something.` : ""}`,
    );
  }

  const status = round.status === "discussing" ? "Discussing" : "Listening";
  const lines = [
    `🎧 **${round.title}**${round.artist ? ` — ${round.artist}` : ""}`,
    `Picked by ${round.dj_name} · ${round.type === "album" ? "Album" : "Song"} · _${status}_`,
    round.url,
  ];
  if (round.note) lines.push(`> ${round.note}`);
  if (round.listen_by) lines.push(`Listen by <t:${round.listen_by}:D> (<t:${round.listen_by}:R>)`);
  if (round.thread_id) lines.push(`Discussion: <#${round.thread_id}>`);
  return reply(c, lines.join("\n"), false, 4);
}

async function handleDiscuss(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
  member: Member,
) {
  const round = await getActiveRound(c.env.DB, interaction.guild_id!);
  if (!round) {
    return reply(c, "Nothing's playing yet — nothing to discuss.", true);
  }
  if (!(member.id === round.dj_id || isAdmin(interaction, club))) {
    return reply(c, "Only the DJ who picked this (or an admin) can open discussion.", true);
  }
  const thread = round.thread_id ? ` — <#${round.thread_id}>` : "";
  if (round.status === "discussing") {
    return reply(c, `Discussion's already open for **${round.title}**${thread}.`, true);
  }
  await markDiscussing(c.env.DB, interaction.guild_id!);
  return reply(c, `💬 Discussion is open for **${round.title}**${thread}.`);
}

async function handleWrap(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
  member: Member,
) {
  const guildId = interaction.guild_id!;
  const round = await getActiveRound(c.env.DB, guildId);
  if (!round) {
    return reply(c, "Nothing to wrap — no pick is active.", true);
  }
  if (!(member.id === round.dj_id || isAdmin(interaction, club))) {
    return reply(c, "Only the DJ who picked this (or an admin) can wrap it.", true);
  }

  await wrapActiveRound(c.env.DB, guildId, Math.floor(Date.now() / 1000));

  // Advance the rotation pointer from whoever is on deck (the picker).
  const current = await getMemberById(c.env.DB, club.current_dj_id ?? round.dj_id);
  const next = current ? await advanceRotation(c.env.DB, guildId, current) : null;
  const nextBlurb = !next
    ? ""
    : next.id === current?.id
      ? ` **${next.display_name}** is still on deck — \`/pick\` when ready.`
      : ` <@${next.discord_id}> is on deck — \`/pick\` when ready.`;

  return reply(c, `📦 Wrapped **${round.title}**.${nextBlurb}`);
}

async function handleHistory(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
) {
  const rounds = await listArchivedRounds(c.env.DB, interaction.guild_id!, 10);
  if (rounds.length === 0) {
    return reply(c, "No wrapped picks yet — history starts after your first `/wrap`.", true);
  }
  const lines = rounds.map((r) => {
    const when = r.wrapped_at ?? r.created_at;
    return `• **${r.title}**${r.artist ? ` — ${r.artist}` : ""} · ${r.dj_name} · <t:${when}:D>`;
  });
  return reply(c, `**${club.name} — recent picks**\n${lines.join("\n")}`);
}

function handleClub(c: AppContext, interaction: DiscordInteraction, club: Club) {
  const sub = interaction.data?.options?.[0];
  if (sub?.name === "reset") {
    return handleClubReset(c, interaction, club, sub);
  }
  return reply(c, "Unknown subcommand.", true);
}

async function handleClubReset(
  c: AppContext,
  interaction: DiscordInteraction,
  club: Club,
  sub: DiscordInteractionOption,
) {
  if (!isAdmin(interaction, club)) {
    return reply(c, "You need **Manage Server** (or the admin role) to reset the club.", true);
  }

  const confirm = sub.options?.find((o) => o.name === "confirm")?.value === true;
  const counts = await clubCounts(c.env.DB, interaction.guild_id!);

  if (!confirm) {
    return reply(
      c,
      `⚠️ This permanently deletes this server's club: **${counts.members}** member(s) and **${counts.rounds}** round(s).\nRe-run \`/club reset confirm:True\` to proceed.`,
      true,
    );
  }

  await resetClub(c.env.DB, interaction.guild_id!);
  return reply(c, "🧹 Club data deleted. The next command starts a fresh club.", true);
}

function isAdmin(i: DiscordInteraction, club: Club): boolean {
  if (hasManageGuild(i)) return true;
  if (club.admin_role_id && i.member?.roles?.includes(club.admin_role_id)) return true;
  return false;
}

function renderSettings(club: Club): string {
  const channel = club.announce_channel_id ? `<#${club.announce_channel_id}>` : "_not set_";
  const role = club.admin_role_id ? `<@&${club.admin_role_id}>` : "_not set_";
  return [
    `**${club.name} — settings**`,
    `Announcement channel: ${channel}`,
    `Admin role: ${role}`,
    `Default listening window: ${club.default_listen_days} day(s)`,
  ].join("\n");
}

// Discord thread names are capped at 100 characters.
function threadName(title: string): string {
  return `🎧 ${title}`.slice(0, 100);
}

// Build the announcement message (embed) posted to the configured channel.
function buildAnnouncement(round: NewRound, djName: string, listenBy: number) {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (round.artist) fields.push({ name: "Artist", value: round.artist, inline: true });
  fields.push({ name: "Type", value: round.type === "album" ? "Album" : "Song", inline: true });
  fields.push({ name: "Listen by", value: `<t:${listenBy}:D> (<t:${listenBy}:R>)` });

  return {
    embeds: [
      {
        author: { name: `🎧 ${djName} picked` },
        title: round.title,
        url: round.url,
        description: round.note ?? undefined,
        color: 0x5865f2,
        fields,
      },
    ],
  };
}

// Build a CHANNEL_MESSAGE_WITH_SOURCE response; ephemeral replies are invoker-only.
// Pass extraFlags to OR in additional Discord message flags (e.g. 4 = SUPPRESS_EMBEDS).
function reply(c: AppContext, content: string, ephemeral = false, extraFlags = 0) {
  const flags = (ephemeral ? MessageFlags.EPHEMERAL : 0) | extraFlags;
  return c.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: flags ? { content, flags } : { content },
  });
}

async function postSearchLinks(
  rest: DiscordRest,
  threadId: string,
  title: string,
  artist: string,
): Promise<void> {
  const q = encodeURIComponent(`${artist} ${title}`);
  const links = [
    `[Spotify](https://open.spotify.com/search?q=${q})`,
    `[Apple Music](https://music.apple.com/search?term=${q})`,
    `[Tidal](https://tidal.com/search?q=${q})`,
    `[YouTube Music](https://music.youtube.com/search?q=${q})`,
    `[YouTube](https://www.youtube.com/results?search_query=${q})`,
  ].join(" · ");
  await rest.createMessage(threadId, { content: `🔍 Find it on: ${links}`, flags: 4 });
}

// Cron handler: nudge listening windows that are nearly up, once each.
async function handleScheduled(_event: ScheduledController, env: Env) {
  const now = Math.floor(Date.now() / 1000);
  const soon = now + 86400; // within the next 24h (or already overdue)
  const due = await listRoundsNeedingReminder(env.DB, soon);
  const rest = new DiscordRest(env.DISCORD_BOT_TOKEN, env.DISCORD_APP_ID);

  for (const round of due) {
    if (!round.thread_id) {
      await markReminded(env.DB, round.id, now);
      continue;
    }
    try {
      await rest.createMessage(round.thread_id, {
        content: `⏳ Heads up — the listening window for **${round.title}** ends <t:${round.listen_by}:R>. Give it a spin!`,
      });
      await markReminded(env.DB, round.id, now);
    } catch {
      // Leave reminded_at unset so the next cron run retries this one.
    }
  }
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: handleScheduled,
};
