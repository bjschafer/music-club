// Odesli / song.link enrichment: turn a single-platform link into a universal
// one so members on any service can play the pick. Free, keyless API.

interface OdesliResponse {
  pageUrl?: string;
}

// Returns the universal song.link page URL, or null if the link is unsupported.
// Throws on rate-limit (429) so the caller (a queue consumer) can retry later.
export async function fetchSonglink(url: string): Promise<string | null> {
  const api = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}&userCountry=US`;
  const res = await fetch(api, { headers: { "User-Agent": "music-club-bot" } });

  if (res.status === 429) {
    throw new Error("song.link rate limited");
  }
  if (!res.ok) {
    // Unsupported URL or other client error — give up gracefully (no retry).
    return null;
  }

  const data = await res.json<OdesliResponse>();
  return data.pageUrl ?? null;
}
