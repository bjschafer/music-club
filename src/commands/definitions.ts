// Slash command definitions registered with Discord via `bun run register`.
// command type 1 = CHAT_INPUT.
// option types: STRING=3, INTEGER=4, BOOLEAN=5, USER=6, CHANNEL=7, ROLE=8.
// default_member_permissions gates admin-only commands (e.g. "32" = Manage Server).

export const commands = [
  {
    name: "ping",
    description: "Check that the Music Club bot is alive",
    type: 1,
  },
  {
    name: "spin",
    description: "Give the turntable a spin 🎶",
    type: 1,
  },
  {
    name: "join",
    description: "Join the DJ rotation for this server's music club",
    type: 1,
  },
  {
    name: "leave",
    description: "Remove yourself from the DJ rotation",
    type: 1,
  },
  {
    name: "rotation",
    description: "Show the DJ rotation and who's on deck",
    type: 1,
  },
  {
    name: "pick",
    description: "Post your pick for the club (current DJ only)",
    type: 1,
    options: [
      // Required options must be listed before optional ones.
      { name: "title", description: "Song or album title", type: 3, required: true },
      {
        name: "url",
        description: "Link to listen (Spotify, Apple, YouTube, Bandcamp…)",
        type: 3,
        required: true,
      },
      { name: "artist", description: "Artist / band", type: 3, required: true },
      {
        name: "type",
        description: "Song or album (defaults to album)",
        type: 3,
        required: false,
        choices: [
          { name: "Album", value: "album" },
          { name: "Song", value: "song" },
        ],
      },
      { name: "why", description: "Why you picked it", type: 3, required: false },
    ],
  },
  {
    name: "extend",
    description: "Extend the current listening window (DJ or admin)",
    type: 1,
    options: [
      {
        name: "days",
        description: "Number of days to add to the listening window",
        type: 4, // INTEGER
        required: true,
        min_value: 1,
        max_value: 30,
      },
    ],
  },
  {
    name: "pass",
    description: "Pass your turn as DJ — the rotation moves on",
    type: 1,
  },
  {
    name: "nowplaying",
    description: "Show the current pick and discussion thread",
    type: 1,
  },
  {
    name: "wrap",
    description: "Wrap the current pick and pass the baton (DJ or admin)",
    type: 1,
  },
  {
    name: "history",
    description: "Show recently wrapped picks",
    type: 1,
  },
  {
    name: "club",
    description: "Manage this server's club",
    type: 1,
    default_member_permissions: "32", // Manage Server
    options: [
      {
        name: "reset",
        description: "Delete all of this server's club data",
        type: 1, // SUB_COMMAND
        options: [
          {
            name: "confirm",
            description: "Set to True to actually delete everything",
            type: 5, // BOOLEAN
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: "setup",
    description: "Configure this server's music club (admins only)",
    type: 1,
    default_member_permissions: "32", // Manage Server — gates the command in the UI.
    options: [
      {
        name: "announce_channel",
        description: "Channel where announcements are posted",
        type: 7, // CHANNEL
      },
      {
        name: "admin_role",
        description: "Role allowed to manage the club",
        type: 8, // ROLE
      },
      {
        name: "listen_days",
        description: "Default listening window, in days",
        type: 4, // INTEGER
        min_value: 1,
        max_value: 60,
      },
    ],
  },
];
