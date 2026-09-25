// Device attestation: proof that a write came from the real MinFinder app on a real device.
//
// iOS uses App Attest. Once per install the app registers a key: Apple certifies it, we check
// the certificate chain and keep the public key. After that every write carries an assertion,
// a signature over the exact request body with a counter that only goes up.
//
// Android uses Play Integrity standard requests. Every write carries a token that Google
// decrypts for us; it names the app, the device's integrity and the hash of the request body.
//
// Both bind to the body the server received, so a token can't be lifted onto another request.
// ATTESTATION in the env picks what failure means: "off", "log" (record the verdict on the mine,
// never refuse; the default while old builds are about) or "enforce" (refuse).
import { createHash, createPublicKey, createVerify, randomBytes, X509Certificate } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

// Apple App Attestation Root CA, from https://www.apple.com/certificateauthority/.
export const APPLE_ROOT = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

export class AttestError extends Error {}
const fail = (why: string): never => {
  throw new AttestError(why);
};

// --- CBOR, just the subset App Attest uses (ints, byte/text strings, arrays, maps). -------------
export function cbor(buf: Buffer): any {
  let i = 0;
  const len = (info: number): number => {
    if (info < 24) return info;
    const n = [1, 2, 4, 8][info - 24] ?? fail("cbor: bad length");
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + buf[i++];
    return v;
  };
  const item = (): any => {
    if (i >= buf.length) fail("cbor: truncated");
    const b = buf[i++];
    const major = b >> 5;
    const n = len(b & 31);
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: return buf.subarray(i, (i += n));
      case 3: return buf.subarray(i, (i += n)).toString("utf8");
      case 4: return Array.from({ length: n }, item);
      case 5: {
        const o: Record<string, any> = {};
        for (let k = 0; k < n; k++) o[item()] = item();
        return o;
      }
      default: return fail(`cbor: unsupported major type ${major}`);
    }
  };
  return item();
}

// --- App Attest --------------------------------------------------------------------------------
// 1.2.840.113635.100.8.2, Apple's nonce extension, as DER.
const NONCE_OID = Buffer.from("06092a864886f763640802", "hex");
const AAGUID = { production: Buffer.from("appattest\0\0\0\0\0\0\0"), development: Buffer.from("appattestdevelop") };

/** The uncompressed EC point at the end of a P-256 SubjectPublicKeyInfo. */
const ecPoint = (cert: X509Certificate) => cert.publicKey.export({ format: "der", type: "spki" }).subarray(-65);

/**
 * Checks a key registration (Apple's "Verify the attestation") and returns the key to keep.
 * `appId` is "<TEAM ID>.<bundle id>"; `challenge` the one-time string we issued.
 */
export function verifyAttestation(opts: { keyId: string; attestation: string; challenge: string; appId: string; root?: string; now?: Date }) {
  const att = cbor(Buffer.from(opts.attestation, "base64"));
  if (att.fmt !== "apple-appattest") fail("not an App Attest object");
  const [leafDer, ...rest] = (att.attStmt?.x5c ?? []) as Buffer[];
  if (!leafDer || rest.length < 1) fail("certificate chain missing");
  const chain = [leafDer, ...rest].map((d) => new X509Certificate(d));
  const root = new X509Certificate(opts.root ?? APPLE_ROOT);
  const now = opts.now ?? new Date();
  for (const [k, cert] of chain.entries()) {
    const issuer = chain[k + 1] ?? root;
    if (!cert.checkIssued(issuer) || !cert.verify(issuer.publicKey)) fail("certificate chain doesn't lead to Apple");
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) fail("certificate expired or not yet valid");
  }
  const leaf = chain[0];

  const authData: Buffer = att.authData;
  const nonce = sha256(Buffer.concat([authData, sha256(opts.challenge)]));
  const at = leaf.raw.indexOf(NONCE_OID);
  const box = at < 0 ? -1 : leaf.raw.indexOf(Buffer.from([0x04, 0x20]), at + NONCE_OID.length);
  if (box < 0 || box > at + 32 || !leaf.raw.subarray(box + 2, box + 34).equals(nonce)) fail("nonce doesn't match the challenge");

  const keyId = Buffer.from(opts.keyId, "base64");
  if (!sha256(ecPoint(leaf)).equals(keyId)) fail("key id isn't this certificate's key");
  if (!authData.subarray(0, 32).equals(sha256(opts.appId))) fail("attested for another app");
  if (authData.readUInt32BE(33) !== 0) fail("counter isn't zero");
  const aaguid = authData.subarray(37, 53);
  const env = aaguid.equals(AAGUID.production) ? "production" : aaguid.equals(AAGUID.development) ? "development" : fail("unknown environment");
  const credLen = authData.readUInt16BE(53);
  if (!authData.subarray(55, 55 + credLen).equals(keyId)) fail("credential id isn't the key id");
  return { publicKey: leaf.publicKey.export({ format: "pem", type: "spki" }) as string, env };
}

/** Checks one request's assertion over `clientData` (the raw body) and returns the new counter. */
export function verifyAssertion(opts: { assertion: string; clientData: string; publicKey: string; counter: number; appId: string }) {
  const a = cbor(Buffer.from(opts.assertion, "base64"));
  const authData: Buffer = a.authenticatorData ?? fail("assertion malformed");
  const nonce = sha256(Buffer.concat([authData, sha256(opts.clientData)]));
  const ok = createVerify("sha256").update(nonce).verify(createPublicKey(opts.publicKey), a.signature);
  if (!ok) fail("signature doesn't match this request");
  if (!authData.subarray(0, 32).equals(sha256(opts.appId))) fail("asserted for another app");
  const counter = authData.readUInt32BE(33);
  if (counter <= opts.counter) fail("replayed assertion");
  return counter;
}

export const newChallenge = () => randomBytes(24).toString("base64url");

// --- Play Integrity ----------------------------------------------------------------------------

/** What we require of a decoded token. Returns null when it passes, or why it doesn't. */
export function playVerdict(p: any, opts: { packageName: string; requestHash: string; now?: number }): string | null {
  const req = p?.requestDetails ?? {};
  if (req.requestPackageName !== opts.packageName) return "token for another app";
  if (req.requestHash !== opts.requestHash) return "token for another request";
  if (Math.abs((opts.now ?? Date.now()) - Number(req.timestampMillis)) > 15 * 60_000) return "token too old";
  if (p?.appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") return `app ${p?.appIntegrity?.appRecognitionVerdict ?? "unknown"}`;
  const device: string[] = p?.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  if (!device.includes("MEETS_DEVICE_INTEGRITY")) return `device ${device.join("+") || "fails integrity"}`;
  return null;
}

// Google's decode call needs an OAuth token for a service account in the linked Cloud project.
// The key file (PLAY_INTEGRITY_KEY_FILE) lives in /etc/minfinder-api/, readable by the service.
let google: { token: string; exp: number } | null = null;
async function googleToken(keyFile: string): Promise<string> {
  if (google && google.exp > Date.now() + 60_000) return google.token;
  const { readFile } = await import("node:fs/promises");
  const key = JSON.parse(await readFile(keyFile, "utf8"));
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/playintegrity" })
    .setProtectedHeader({ alg: "RS256", kid: key.private_key_id })
    .setIssuer(key.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(await importPKCS8(key.private_key, "RS256"));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!r.ok) throw new Error(`google oauth ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  google = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return google.token;
}

/** Decrypts a token through Google. Throws plain Error when Google can't be reached. */
export async function decodePlayToken(token: string, packageName: string, keyFile: string): Promise<any> {
  const r = await fetch(`https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await googleToken(keyFile)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ integrity_token: token }),
  });
  if (r.status === 400) fail("token unreadable");
  if (!r.ok) throw new Error(`play integrity ${r.status}`);
  return ((await r.json()) as any).tokenPayloadExternal;
}

export const bodyHash = (body: string) => sha256(body).toString("hex");
