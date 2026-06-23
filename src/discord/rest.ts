// Minimal Discord REST client for the calls this bot makes: posting an
// announcement, starting a discussion thread, and editing a deferred interaction
// response. Authenticated with the bot token; no gateway connection needed.

const API = "https://discord.com/api/v10";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Discord returns `retry_after` (seconds) in a 429 body. Cap the wait so a queue
// consumer or background task doesn't stall.
async function retryAfterMs(res: Response): Promise<number> {
  try {
    const body = await res.json<{ retry_after?: number }>();
    return Math.min((body.retry_after ?? 1) * 1000, 5000);
  } catch {
    return 1000;
  }
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
}

export class DiscordRest {
  constructor(
    private readonly token: string,
    private readonly appId: string,
  ) {}

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Respect Discord rate limits: wait out `retry_after`, then retry briefly.
    if (res.status === 429 && attempt < 2) {
      await sleep(await retryAfterMs(res));
      return this.call<T>(method, path, body, attempt + 1);
    }

    if (!res.ok) {
      // Surface status + body so callers can report a useful error. The body may
      // contain Discord's error code/message (e.g. missing permissions).
      throw new Error(`Discord ${method} ${path} → ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? (null as T) : await res.json<T>();
  }

  createMessage(channelId: string, payload: unknown): Promise<DiscordMessage> {
    return this.call<DiscordMessage>("POST", `/channels/${channelId}/messages`, payload);
  }

  // Start a public thread anchored to an existing message.
  // auto_archive_duration is in minutes; 10080 = 7 days (covers a listening window).
  startThreadFromMessage(
    channelId: string,
    messageId: string,
    name: string,
    autoArchiveMinutes = 10080,
  ): Promise<DiscordChannel> {
    return this.call<DiscordChannel>(
      "POST",
      `/channels/${channelId}/messages/${messageId}/threads`,
      { name, auto_archive_duration: autoArchiveMinutes },
    );
  }

  // Edit the original (deferred) interaction response. Authenticated by the
  // interaction token in the URL — valid for 15 minutes after the interaction.
  editOriginalResponse(interactionToken: string, payload: unknown): Promise<unknown> {
    return this.call(
      "PATCH",
      `/webhooks/${this.appId}/${interactionToken}/messages/@original`,
      payload,
    );
  }
}
