// Discord interaction constants and payload shapes.
// Integer values per the Discord interactions API.

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
} as const;

// Message flags. EPHEMERAL (1 << 6) makes a reply visible only to the invoker.
export const MessageFlags = {
  EPHEMERAL: 1 << 6,
} as const;

// ApplicationCommandOptionType: STRING=3, INTEGER=4, BOOLEAN=5, USER=6, CHANNEL=7.

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface DiscordInteractionOption {
  name: string;
  type: number;
  // Leaf options carry a value; subcommands (type 1) carry nested options instead.
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
}

export interface DiscordInteraction {
  id: string;
  type: number;
  application_id: string;
  token: string;
  // Present for interactions invoked inside a guild.
  guild_id?: string;
  channel_id?: string;
  // In a guild the invoker is under `member.user`; in DMs it's `user`.
  // `permissions` is a bitfield string; `roles` lists the member's role ids.
  member?: { user: DiscordUser; permissions: string; roles: string[] };
  user?: DiscordUser;
  data?: {
    id: string;
    name: string;
    options?: DiscordInteractionOption[];
  };
}

// Resolve the invoking user regardless of guild vs DM context.
export function interactionUser(i: DiscordInteraction): DiscordUser | undefined {
  return i.member?.user ?? i.user;
}

// MANAGE_GUILD ("Manage Server") permission bit (0x20).
const MANAGE_GUILD = 1n << 5n;

export function hasManageGuild(i: DiscordInteraction): boolean {
  try {
    return (BigInt(i.member?.permissions ?? "0") & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
}

// Look up a slash command option value by name.
export function getOption(
  i: DiscordInteraction,
  name: string,
): string | number | boolean | undefined {
  return i.data?.options?.find((o) => o.name === name)?.value;
}
