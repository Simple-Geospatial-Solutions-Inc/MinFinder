import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { api } from "@/lib/auth";
import { kvGet, kvSet } from "@/lib/userDb";

/**
 * Device attestation for uploads and votes: App Attest on iOS, Play Integrity on
 * Android, each bound to the exact body being sent (see "Device attestation" in
 * artifacts/minfinder-api/README.md). Best effort on this side: a device that
 * can't attest sends nothing, and the server decides what that means.
 */

// Builds from before the module was added don't have it; they must keep uploading.
let AppIntegrity: typeof import("@expo/app-integrity") | null = null;
try {
  AppIntegrity = require("@expo/app-integrity");
} catch {
  AppIntegrity = null;
}

const CLOUD_PROJECT = process.env.EXPO_PUBLIC_GCP_PROJECT_NUMBER;
let prepared: Promise<void> | null = null;

/** Headers to send with `body`; empty when the device can't attest. */
export async function attestHeaders(body: string): Promise<Record<string, string>> {
  try {
    const value = await header(body);
    return value ? { "X-Attest": value } : {};
  } catch (e) {
    console.warn("[attest]", e);
    return {};
  }
}

async function header(body: string): Promise<string | null> {
  const ai = AppIntegrity;
  if (!ai) return null;
  if (Platform.OS === "android") {
    if (!CLOUD_PROJECT) return null;
    // Google's warm-up takes a few seconds; once per launch is enough.
    prepared ??= ai.prepareIntegrityTokenProviderAsync(CLOUD_PROJECT).catch((e) => {
      prepared = null;
      throw e;
    });
    await prepared;
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, body);
    return `android ${await ai.requestIntegrityCheckAsync(hash)}`;
  }
  if (Platform.OS === "ios" && ai.isSupported) {
    const keyId = await iosKey(ai);
    return `ios ${keyId} ${await ai.generateAssertionAsync(keyId, body)}`;
  }
  return null;
}

/** This install's App Attest key, registered with the server the first time. */
async function iosKey(ai: typeof import("@expo/app-integrity")): Promise<string> {
  const saved = await kvGet<string>("attest_key");
  if (saved) return saved;
  const keyId = await ai.generateKeyAsync();
  const { challenge } = await api<{ challenge: string }>("/attest/challenge");
  const attestation = await ai.attestKeyAsync(keyId, challenge);
  await api("/attest/ios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key_id: keyId, attestation, challenge }),
  });
  await kvSet("attest_key", keyId);
  return keyId;
}

/** Call when the server says it doesn't know this install's key; the next write makes a new one. */
export async function forgetAttestKey(): Promise<void> {
  await kvSet("attest_key", null);
}
