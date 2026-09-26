import * as AppleAuthentication from "expo-apple-authentication";
import {
  GoogleSignin,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

/** The field-reports API (artifacts/minfinder-api). Override per EAS profile. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://api.sgss.ca";

// OAuth client ids are public by design; the server checks each id token's `aud`
// against the same list (GOOGLE_CLIENT_IDS). Android signs in through the Web
// client, so its tokens carry the Web id; iOS tokens carry the iOS id.
const GOOGLE_WEB_CLIENT_ID =
  "444119579996-cfslsslugel1cji5lgai7uik979bc7vi.apps.googleusercontent.com";
// Also in app.json's google-signin `iosUrlScheme` (reversed) and the server's
// GOOGLE_CLIENT_IDS.
const GOOGLE_IOS_CLIENT_ID =
  "444119579996-srbacl2iiu9krhksg3ca49jg0g0be02k.apps.googleusercontent.com";

const TOKEN_KEY = "minfinder.session";

export class ApiError extends Error {
  status: number;
  code: string;
  body: Record<string, unknown>;
  constructor(status: number, code: string, message: string, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// --- Session ---------------------------------------------------------------
// The session token lives in the keychain/keystore; this mirrors it in memory
// so the UI can read "signed in?" synchronously.
let token: string | null = null;
const listeners = new Set<() => void>();
const loaded = SecureStore.getItemAsync(TOKEN_KEY)
  .then((t) => setToken(t, false))
  .catch(() => {});

async function setToken(t: string | null, persist = true) {
  token = t;
  listeners.forEach((l) => l());
  if (!persist) return;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function useSignedIn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => token !== null,
  );
}

export async function isSignedIn(): Promise<boolean> {
  await loaded;
  return token !== null;
}

/**
 * fetch against /v1. Throws ApiError for any non-2xx answer (with the server's
 * stable `error` code) and lets network failures through as TypeError, so a
 * caller can tell "the server said no" from "we never reached it".
 */
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  await loaded;
  const sent = token;
  const res = await fetch(`${API_URL}/v1${path}`, {
    ...init,
    headers: { ...(init.headers as object), ...(sent ? { Authorization: `Bearer ${sent}` } : {}) },
  });
  if (res.status === 204) return null as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A dead session (expired, banned, account deleted elsewhere). Dropping it is
    // what makes the UI ask to sign in again. Only if it's still the token we
    // sent, so a sign-in that landed meanwhile isn't undone.
    if (res.status === 401 && sent && token === sent) await setToken(null);
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body.message ?? "", body);
  }
  return body as T;
}

/** For requests that skip api(), like images: a pending mine's photos are its author's only. */
export function authHeader(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type Provider = "apple" | "google";

/** Returns false when the user backs out of the provider's sheet. */
export async function signIn(provider: Provider): Promise<boolean> {
  let idToken: string | null = null;
  let authorizationCode: string | null = null; // Apple only: lets the API revoke the grant on account deletion
  if (provider === "apple") {
    try {
      // No scopes: we store only Apple's opaque user id, never a name or email.
      const cred = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      idToken = cred.identityToken;
      authorizationCode = cred.authorizationCode;
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return false;
      throw e;
    }
  } else {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID,
    });
    await GoogleSignin.hasPlayServices();
    const r = await GoogleSignin.signIn();
    if (!isSuccessResponse(r)) return false;
    idToken = r.data.idToken;
  }
  if (!idToken) throw new Error("The sign-in provider returned no identity token.");
  const { token: session } = await api<{ token: string }>(`/auth/${provider}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken, authorization_code: authorizationCode ?? undefined }),
  });
  await setToken(session);
  return true;
}

export async function signOut(): Promise<void> {
  await setToken(null);
  // Forget the Google account too, so the next sign-in offers the picker.
  await GoogleSignin.signOut().catch(() => {});
}
