// The staff moderation page, served by the API itself at /admin.
//
// Gated here, not in Caddy: HTTP Basic against ADMIN_PASSWORD from the service's env file, and
// the page 404s when that isn't set, so a missing Caddy rule can never expose it. Actions are
// POSTed forms; a cross-site POST is refused by checking Origin against Host.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DB } from "./db.ts";
import { queue, reportReasons } from "./moderation.ts";
import { tier } from "./rules.ts";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** null = let them in; otherwise the status to answer with. */
export function adminGate(req: IncomingMessage, password = process.env.ADMIN_PASSWORD): null | 401 | 403 | 404 {
  if (!password) return 404;
  const m = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
  const given = m ? Buffer.from(m[1], "base64").toString().split(":").slice(1).join(":") : "";
  if (!timingSafeEqual(sha(given), sha(password))) return 401;
  if (req.method === "POST") {
    const origin = req.headers.origin;
    if (origin && origin !== "null" && new URL(origin).host !== req.headers.host) return 403;
  }
  return null;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

function card(db: DB, m: Record<string, any>): string {
  const t = tier({ approved: !!m.approved, staffVerified: !!m.staff_verified, net: m.net, onSiteUp: m.on_site_up, reports: m.reports });
  const photos = (JSON.parse(m.photo_ids) as string[])
    .map((p) => `<a href="/admin/photos/${esc(p)}.jpg" target="_blank"><img src="/admin/photos/${esc(p)}_t.jpg" alt=""></a>`)
    .join("");
  const reasons = reportReasons(db, m.id).map((r) => `${esc(r.reason)} ×${r.n}`).join(", ");
  const hazards = JSON.parse(m.hazards) as string[];
  const btn = (action: string, label: string, danger = false) =>
    `<form method="post" action="/admin/${action}/${esc(m.id)}"${danger ? ` onsubmit="return confirm('${label}?')"` : ""}>` +
    `<button class="${danger ? "danger" : ""}">${label}</button></form>`;
  const map = `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lon}`;
  return `<article>
  <div class="photos">${photos}</div>
  <div class="body">
    <h2>${esc(m.name || m.type)} <span class="tier">${t}</span></h2>
    <p class="meta">${esc(m.type)} · captured ${when(m.captured_at)} · author #${esc(m.user_id ?? "deleted")} · net ${m.net} (${m.ups}▲ ${m.downs}▼, ${m.on_site_up} on site)</p>
    <p class="meta"><a href="${map}" target="_blank">${m.lat.toFixed(5)}, ${m.lon.toFixed(5)}</a> · ±${Math.round(m.accuracy_m)} m · device check: ${esc(m.attest ?? "not recorded")}</p>
    ${m.notes ? `<p>${esc(m.notes)}</p>` : ""}
    ${hazards.length ? `<p class="meta">Hazards: ${esc(hazards.join(", "))}</p>` : ""}
    ${m.hold && !m.approved ? `<p class="reports">Held: inside ${esc(m.hold)}. Check it isn't a heritage or cultural site, and that it's fine to publish there.</p>` : ""}
    ${reasons ? `<p class="reports">Reported: ${reasons}</p>` : ""}
    <div class="actions">
      ${m.approved ? "" : btn("approve", "Approve")}
      ${btn("verify", "Verify")}
      ${m.reports ? btn("restore", "Clear reports") : ""}
      ${btn("remove", "Remove", true)}
      ${m.user_id != null ? btn("ban", "Ban author", true) : ""}
    </div>
  </div>
</article>`;
}

export function adminPage(db: DB, msg: string | null): string {
  const items = queue(db);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MinFinder moderation</title>
<style>
  :root { color-scheme: light dark; --ink: #0E2444; --muted: #5F6B7A; --line: #D9DEE5; --bg: #F5F7FA; --card: #fff; --bad: #B3261E; }
  @media (prefers-color-scheme: dark) { :root { --ink: #E8EDF3; --muted: #9AA6B4; --line: #2A3444; --bg: #0B1320; --card: #131D2C; --bad: #F08A80; } }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 0; }
  .meta, .sub { color: var(--muted); font-size: 14px; margin: 4px 0; }
  .msg { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; }
  article { display: flex; gap: 16px; flex-wrap: wrap; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-top: 16px; }
  .photos { display: flex; gap: 8px; } .photos img { width: 112px; height: 112px; object-fit: cover; border-radius: 12px; display: block; }
  .body { flex: 1; min-width: 240px; } p { margin: 6px 0; }
  .reports { color: var(--bad); font-weight: 600; }
  .tier { font-size: 12px; font-weight: 600; border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; vertical-align: middle; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; } form { margin: 0; }
  button { font: 600 14px system-ui, sans-serif; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); cursor: pointer; }
  button.danger { color: var(--bad); }
  a { color: inherit; }
</style></head>
<body><main>
<h1>Moderation queue</h1>
<p class="sub">New accounts' first submissions, and anything reported or voted down. ${items.length} waiting.</p>
${msg ? `<p class="msg">${esc(msg)}</p>` : ""}
${items.map((m) => card(db, m)).join("\n") || `<p class="sub">Nothing to review.</p>`}
</main></body></html>`;
}
