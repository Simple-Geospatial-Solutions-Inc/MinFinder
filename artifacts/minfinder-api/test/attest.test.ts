// App Attest and Play Integrity checks. Apple's chain can't be minted offline, so openssl builds
// a stand-in root -> intermediate -> leaf with the same nonce extension, and the verifier is
// pointed at that root. Everything past the root is the code that runs in production.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cbor, playVerdict, verifyAssertion, verifyAttestation } from "../src/attest.ts";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

// Minimal CBOR encoder for the test's own objects.
function enc(v: unknown): Buffer {
  const head = (major: number, n: number) =>
    n < 24 ? Buffer.from([(major << 5) | n])
    : n < 256 ? Buffer.from([(major << 5) | 24, n])
    : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(enc)]);
  const entries = Object.entries(v as object);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [enc(k), enc(x)])]);
}

const APP_ID = "TEAM123456.ca.sgss.minfinder";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "attest-"));
  const ssl = (...args: string[]) =>
    execFileSync("openssl", args, { cwd: dir, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, stdio: "pipe" });
  const caExt = "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n";
  writeFileSync(join(dir, "ca.ext"), caExt);
  ssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "root.key");
  ssl("req", "-x509", "-new", "-key", "root.key", "-subj", "/CN=Test Root", "-days", "2", "-out", "root.pem",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
  ssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "int.key");
  ssl("req", "-new", "-key", "int.key", "-subj", "/CN=Test Intermediate", "-out", "int.csr");
  ssl("x509", "-req", "-in", "int.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-days", "2", "-extfile", "ca.ext", "-out", "int.pem");

  // The device's key, and the authenticator data App Attest would produce for it.
  const leaf = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(join(dir, "leaf.key"), leaf.privateKey.export({ format: "pem", type: "pkcs8" }));
  const keyIdBuf = sha256(leaf.publicKey.export({ format: "der", type: "spki" }).subarray(-65));
  const keyId = keyIdBuf.toString("base64");
  const counter = Buffer.alloc(4);
  const credLen = Buffer.from([0, 32]);
  const authData = Buffer.concat([sha256(APP_ID), Buffer.from([0x40]), counter, Buffer.from("appattestdevelop"), credLen, keyIdBuf]);
  const challenge = "server-challenge";
  const nonce = sha256(Buffer.concat([authData, sha256(challenge)]));
  writeFileSync(join(dir, "leaf.ext"), `1.2.840.113635.100.8.2=DER:3024a1220420${nonce.toString("hex")}\n`);
  ssl("req", "-new", "-key", "leaf.key", "-subj", "/CN=Test Leaf", "-out", "leaf.csr");
  ssl("x509", "-req", "-in", "leaf.csr", "-CA", "int.pem", "-CAkey", "int.key", "-CAcreateserial", "-days", "2", "-extfile", "leaf.ext", "-out", "leaf.pem");

  const der = (f: string) => Buffer.from(ssl("x509", "-in", f, "-outform", "DER"));
  const root = ssl("x509", "-in", "root.pem").toString();
  const attestation = enc({ fmt: "apple-appattest", attStmt: { x5c: [der("leaf.pem"), der("int.pem")], receipt: Buffer.alloc(0) }, authData }).toString("base64");
  rmSync(dir, { recursive: true, force: true });

  const assert_ = (clientData: string, n: number) => {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(n);
    const ad = Buffer.concat([sha256(APP_ID), Buffer.from([0x40]), c]);
    const signature = createSign("sha256").update(sha256(Buffer.concat([ad, sha256(clientData)]))).sign(leaf.privateKey);
    return enc({ signature, authenticatorData: ad }).toString("base64");
  };
  return { root, keyId, challenge, attestation, assertion: assert_ };
}

test("cbor decodes what App Attest sends", () => {
  assert.deepEqual(cbor(enc({ a: "x", b: [Buffer.from([1, 2])] })), { a: "x", b: [Buffer.from([1, 2])] });
});

test("App Attest: registration and assertions", () => {
  const f = fixture();
  const ok = { keyId: f.keyId, attestation: f.attestation, challenge: f.challenge, appId: APP_ID, root: f.root };
  const key = verifyAttestation(ok);
  assert.equal(key.env, "development");

  assert.throws(() => verifyAttestation({ ...ok, challenge: "another" }), /nonce/);
  assert.throws(() => verifyAttestation({ ...ok, appId: "OTHER.app" }), /another app/);
  assert.throws(() => verifyAttestation({ ...ok, root: undefined }), /chain/, "a chain that isn't Apple's is refused");

  const body = '{"value":1}';
  const n = verifyAssertion({ assertion: f.assertion(body, 1), clientData: body, publicKey: key.publicKey, counter: 0, appId: APP_ID });
  assert.equal(n, 1);
  assert.throws(() => verifyAssertion({ assertion: f.assertion(body, 1), clientData: body, publicKey: key.publicKey, counter: 1, appId: APP_ID }), /replayed/);
  assert.throws(() => verifyAssertion({ assertion: f.assertion(body, 2), clientData: '{"value":-1}', publicKey: key.publicKey, counter: 1, appId: APP_ID }), /signature/);
});

test("Play Integrity verdicts", () => {
  const now = Date.now();
  const good = {
    requestDetails: { requestPackageName: "ca.sgss.minfinder", requestHash: "abc", timestampMillis: String(now) },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
  };
  const opts = { packageName: "ca.sgss.minfinder", requestHash: "abc", now };
  assert.equal(playVerdict(good, opts), null);
  assert.match(playVerdict(good, { ...opts, requestHash: "other" })!, /another request/);
  assert.match(playVerdict({ ...good, appIntegrity: { appRecognitionVerdict: "UNRECOGNIZED_VERSION" } }, opts)!, /UNRECOGNIZED/);
  assert.match(playVerdict({ ...good, deviceIntegrity: { deviceRecognitionVerdict: [] } }, opts)!, /device/);
  assert.match(playVerdict(good, { ...opts, now: now + 20 * 60_000 })!, /old/);
});
