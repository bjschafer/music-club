// Verifies that an incoming interaction request genuinely came from Discord.
//
// Discord signs `timestamp + rawBody` with the application's Ed25519 private key
// and sends the signature (hex) in `X-Signature-Ed25519` and the timestamp in
// `X-Signature-Timestamp`. We verify against the app's public key (hex).
//
// IMPORTANT: verify the RAW request body, never a re-serialized JSON object —
// any whitespace/key-order change alters the signed bytes and fails verification.
//
// Uses the Workers runtime's native Web Crypto `Ed25519` (no compat flag, no
// third-party crypto library required).

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyDiscordRequest(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyHex: string,
): Promise<boolean> {
  if (!signature || !timestamp) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(publicKeyHex),
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const message = new TextEncoder().encode(timestamp + rawBody);

  try {
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signature),
      message,
    );
  } catch {
    // Malformed hex or signature length — treat as invalid rather than throwing.
    return false;
  }
}
