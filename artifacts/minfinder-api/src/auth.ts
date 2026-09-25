import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { DB } from "./db.ts";

// Sign-in: the app gets an ID token from Apple or Google, we check its signature against the
// provider's published keys, then hand back our own opaque session token. We never see a
// password, and revoking a session is a row delete.

const PROVIDERS = {
  apple: {
    jwks: createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
    issuer: ["https://appleid.apple.com"],
    audienceEnv: "APPLE_AUDIENCES", // the bundle id, ca.sgss.minfinder
  },
  google: {
    jwks: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audienceEnv: "GOOGLE_CLIENT_IDS", // the OAuth client ids the app signs in with
  },
} as const;

export type Provider = keyof typeof PROVIDERS;

export function isProvider(p: string): p is Provider {
  return Object.hasOwn(PROVIDERS, p);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function verifyIdToken(provider: Provider, idToken: string): Promise<string> {
  const p = PROVIDERS[provider];
  const audience = (process.env[p.audienceEnv] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // An empty audience list would make jose skip the aud check and accept tokens minted for
  // any app. Refuse instead.
  if (!audience.length) throw new Error(`${p.audienceEnv} is not configured`);
  const { payload } = await jwtVerify(idToken, p.jwks, { issuer: [...p.issuer], audience });
  if (!payload.sub) throw new Error("token has no sub");
  return payload.sub;
}

export function signIn(db: DB, provider: Provider, sub: string): { token: string; userId: number } {
  db.prepare("INSERT OR IGNORE INTO users (provider, sub, created_at) VALUES (?, ?, ?)").run(provider, sub, Date.now());
  const user = db.prepare("SELECT id, banned FROM users WHERE provider = ? AND sub = ?").get(provider, sub) as {
    id: number;
    banned: number;
  };
  if (user.banned) throw new Error("banned");
  return { token: createSession(db, user.id), userId: user.id };
}

export function createSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)").run(sha256(token), userId, Date.now());
  return token;
}

// Returns the user id for a live session on an unbanned account, or null.
export function sessionUser(db: DB, authHeader: string | undefined): number | null {
  const token = authHeader?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return null;
  const row = db
    .prepare("SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.banned = 0")
    .get(sha256(token)) as { id: number } | undefined;
  return row?.id ?? null;
}
