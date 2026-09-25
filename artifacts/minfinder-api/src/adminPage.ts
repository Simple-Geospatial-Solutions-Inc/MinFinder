// The staff moderation page, served by the API itself at /admin.
//
// Gated here, not in Caddy: HTTP Basic against ADMIN_PASSWORD from the service's env file, and
// the page 404s when that isn't set, so a missing Caddy rule can never expose it. Actions are
// POSTed forms; a cross-site POST is refused by checking Origin against Host.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DB } from "./db.ts";
import { publishedPoint } from "./minfile.ts";
import { queue, reportReasons, statusOfRow } from "./moderation.ts";

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

// Staff are in BC, so times are Pacific, not the server's UTC.
const when = (ms: number) =>
  new Date(ms).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" });

const REASON: Record<string, string> = {
  spam: "Spam",
  inappropriate: "Offensive",
  photo_not_this_site: "Photos of somewhere else",
  dangerous: "Sends people somewhere dangerous",
  other: "Something else",
};
/** "Provincial park: GARIBALDI PARK" -> "Garibaldi Park, a provincial park". */
const heldIn = (hold: string) => {
  const [kind, name] = hold.includes(": ") ? hold.split(": ", 2) : ["", hold];
  const title = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return kind ? `${title}, a ${kind.toLowerCase()}` : title;
};
const ATTEST: Record<string, string> = { pass: "Passed" };
const mapLink = (label: string, lat: number, lon: number) =>
  `<a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener">${label} <span class="num">${lat.toFixed(5)}, ${lon.toFixed(5)}</span></a>`;
const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const fact = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

/**
 * One queue item, read top to bottom in the order staff decide: why it's here, what it is and
 * where, what the member wrote, the evidence, then the actions.
 */
function card(db: DB, m: Record<string, any>): string {
  const verdicts = JSON.parse(m.verdicts) as [number, number][];
  // Visitors other than the author, whose own capture the status counts as one more agree.
  const agree = verdicts.filter((v) => v[0] > 0).length;
  const disagree = verdicts.filter((v) => v[0] < 0).length;
  const photos = (JSON.parse(m.photo_ids) as string[])
    .map((p, i) => `<a href="/admin/photos/${esc(p)}.jpg" target="_blank"><img src="/admin/photos/${esc(p)}_t.jpg" alt="Photo ${i + 1}"></a>`)
    .join("");
  const reasons = reportReasons(db, m.id);
  const pub = publishedPoint(m.minfilno);

  // Why it's in the queue. Several can apply; each says what to check.
  const why: string[] = [];
  if (m.reports)
    why.push(
      `<p class="why bad"><strong>Flagged by ${m.reports} ${m.reports === 1 ? "member" : "members"}</strong> ${reasons.map((r) => `${esc(REASON[r.reason] ?? r.reason)}${r.n > 1 ? ` (${r.n})` : ""}`).join(" · ")}</p>`,
    );
  if (statusOfRow(m) === "collapsed")
    why.push(`<p class="why warn"><strong>Most visitors disagree</strong> ${disagree} of ${agree + disagree} who checked on site say it's wrong. The app tucks it behind “Show” until you decide.</p>`);
  if (!m.approved && m.hold)
    why.push(
      `<p class="why warn"><strong>Held: inside ${esc(heldIn(m.hold))}</strong> Check it isn't a heritage or cultural site, and that it's fine to publish there.</p>`,
    );
  else if (!m.approved) why.push(`<p class="why"><strong>New member</strong> Their first reports need approval before anyone sees them.</p>`);

  const title =
    m.kind === "location"
      ? `${esc(String(m.label ?? "other").replace(/^./, (c) => c.toUpperCase()))} location`
      : m.kind === "not_found"
        ? "Couldn't find it"
        : "Comment";
  const facts = [
    m.kind === "location" && fact("From published point", `${metres(m.distance_m)}${m.far_ack ? ` <span class="aside">author confirmed</span>` : ""}`),
    m.kind === "not_found" && fact("Searched", `${m.search_radius_m} m around the published point`),
    m.kind !== "note" && fact("GPS accuracy", `±${Math.round(m.accuracy_m)} m`),
    m.kind !== "note" && fact("Other visitors", agree + disagree ? `${agree} agree · ${disagree} disagree` : "None yet"),
    fact(m.kind === "note" ? "Written" : "Captured on site", when(m.captured_at)),
    fact("Author", m.user_id != null ? `#${esc(m.user_id)}` : "Deleted account"),
    fact("Device check", esc(m.attest ? (ATTEST[m.attest] ?? m.attest) : "Not recorded")),
  ].filter(Boolean);
  const links = [
    m.kind === "location" && m.lat !== null && mapLink("Reported point", m.lat, m.lon),
    m.kind === "not_found" && m.lat !== null && mapLink("Where they stood", m.lat, m.lon),
    pub && mapLink("Published point", pub.lat, pub.lon),
  ].filter(Boolean);

  const btn = (action: string, label: string, cls = "") =>
    `<form method="post" action="/admin/${action}/${esc(m.id)}"${cls === "danger" ? ` onsubmit="return confirm('${label}?')"` : ""}>` +
    `<button class="${cls}">${label}</button></form>`;
  return `<article data-id="${esc(m.id)}" tabindex="0">
  ${why.join("")}
  <header>
    <h2>${title}</h2>
    <p class="mine"><span class="name">${esc(pub?.name || "Unnamed mine")}</span> <span class="num">MINFILE ${esc(m.minfilno)}</span></p>
  </header>
  ${m.text ? `<blockquote>${esc(m.text)}</blockquote>` : ""}
  ${photos ? `<div class="photos">${photos}</div>` : ""}
  <dl>${facts.join("")}</dl>
  ${links.length ? `<p class="links">${links.join("")}</p>` : ""}
  <div class="actions">
    ${m.approved ? "" : btn("approve", "Approve", "primary")}
    ${btn("verify", "Verify")}
    ${m.reports ? btn("restore", "Clear flags") : ""}
    <span class="spacer"></span>
    ${btn("remove", "Remove", "danger")}
    ${m.user_id != null ? btn("ban", "Ban author", "danger") : ""}
  </div>
</article>`;
}

// The tile server publishes the app's own basemap style, so staff see the ground the app shows.
const STYLE_URL = "https://tiles.sgss.ca/style.json";
const MAPLIBRE = "https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist";

/** What the map needs per card: the published MINFILE point, and the report's own point if it has one. */
function mapItem(m: Record<string, any>) {
  const pub = publishedPoint(m.minfilno);
  return {
    id: m.id,
    minfilno: m.minfilno,
    kind: m.kind,
    pub: pub && [pub.lon, pub.lat],
    pt: m.lat === null ? null : [m.lon, m.lat],
    r: m.search_radius_m ?? null,
  };
}

export function adminPage(db: DB, msg: string | null, failed = false): string {
  const items = queue(db);
  // "<" escaped so nothing in the data can close the script tag it's embedded in.
  const data = JSON.stringify(items.map(mapItem)).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MinFinder moderation</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css">
<style>
  /* MinFinder's own palette (sgs-minfinder/DESIGN.md), so staff and members see one product. */
  :root {
    color-scheme: light dark;
    --bg: #F4F1EA; --card: #FFFFFF; --sunk: #F4F1EA; --line: #E6DFCE; --line-strong: #D7CFBE;
    --ink: #0E1A2B; --muted: #5F6B7A; --navy: #16365C; --gold: #FCBA19; --on-gold: #0E2444; --sel: #C98F0C;
    --warn: #6B4700; --warn-bg: #FFF1CC; --bad: #8C1D17; --bad-bg: #FBE4E2; --destructive: #B3261E;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0E2444; --card: #142A4A; --sunk: #0E2444; --line: #1F3E70; --line-strong: #2B4F86;
      --ink: #F4F1EA; --muted: #9BA9BD; --navy: #CFE0F5; --sel: #FCBA19;
      --warn: #FFD873; --warn-bg: #3A3212; --bad: #F4A59D; --bad-bg: #3D1C22; --destructive: #F4A59D;
    }
  }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--ink); display: flex;
    font: 400 1rem/1.5 Inter, system-ui, sans-serif; font-feature-settings: "cv11", "ss01"; -webkit-font-smoothing: antialiased;
  }
  /* Google Maps on desktop: a scrolling panel on the left, the map filling the rest. */
  aside { width: 480px; flex: none; height: 100%; overflow-y: auto; box-sizing: border-box; padding: 24px 20px 64px; border-right: 1px solid var(--line-strong); }
  #map { flex: 1; height: 100%; position: relative; }
  @media (max-width: 860px) {
    body { flex-direction: column; }
    #map { flex: none; height: 40vh; order: -1; }
    aside { width: auto; flex: 1; height: auto; border-right: 0; border-top: 1px solid var(--line-strong); padding: 20px 16px 48px; }
  }
  h1 { font-size: 1.5rem; line-height: 1.2; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
  .sub { color: var(--muted); font-size: 0.9375rem; margin: 6px 0 0; text-wrap: pretty; }
  .count { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  /* What the last action did: over the map, so it never shifts the queue. Successes fade; failures stay. */
  .toast {
    position: fixed; z-index: 2; left: calc(480px + (100vw - 480px) / 2); bottom: 40px; transform: translateX(-50%);
    margin: 0; max-width: min(560px, calc(100vw - 520px)); box-sizing: border-box; padding: 12px 18px; border-radius: 14px;
    background: #0E2444; color: #F4F1EA; font-weight: 500; font-size: 0.9375rem; line-height: 1.4; text-wrap: pretty;
    box-shadow: 0 6px 24px rgba(14, 36, 68, .28); animation: toast-out 300ms ease-in 4.5s forwards;
  }
  .toast.failed { background: var(--bad-bg); color: var(--bad); border: 1px solid currentColor; animation: none; }
  @keyframes toast-out { to { opacity: 0; visibility: hidden; } }
  @media (max-width: 860px) { .toast { left: 50%; bottom: 24px; max-width: calc(100vw - 32px); } }
  @media (prefers-reduced-motion: reduce) { .toast { animation-duration: 0s; } }
  .empty { color: var(--muted); margin-top: 24px; }
  .num { font-variant-numeric: tabular-nums; }

  article {
    background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px 18px 14px; margin-top: 16px;
    cursor: pointer; transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
  }
  article:hover { border-color: var(--line-strong); }
  article.sel { border-color: var(--sel); box-shadow: 0 0 0 1px var(--sel); }
  article:focus-visible { outline: 2px solid var(--sel); outline-offset: 2px; }

  /* Why it's here: first, because it's what the decision turns on. */
  .why { margin: 0 0 12px; padding: 8px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4; background: var(--sunk); color: var(--ink); text-wrap: pretty; }
  .why strong { display: block; font-weight: 600; }
  .why.warn { background: var(--warn-bg); color: var(--warn); }
  .why.bad { background: var(--bad-bg); color: var(--bad); }

  header { margin-bottom: 12px; }
  h2 { font-size: 1.25rem; line-height: 1.25; font-weight: 700; letter-spacing: -0.005em; margin: 0; text-wrap: balance; }
  .mine { margin: 2px 0 0; font-size: 0.9375rem; }
  .mine .name { font-weight: 600; color: var(--navy); }
  .mine .num { color: var(--muted); margin-left: 6px; }

  /* The member's own words, in their own voice. */
  blockquote { margin: 0 0 14px; font-size: 1rem; line-height: 1.55; max-width: 65ch; white-space: pre-line; text-wrap: pretty; padding-left: 14px; border-left: 1px solid var(--line-strong); }

  .photos { display: flex; gap: 8px; margin: 0 0 14px; overflow-x: auto; }
  .photos img { width: 120px; height: 120px; object-fit: cover; border-radius: 10px; display: block; }

  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 0; padding: 12px 0; border-top: 1px solid var(--line); }
  dl div { min-width: 0; }
  dt { font-size: 0.8125rem; color: var(--muted); line-height: 1.3; }
  dd { margin: 1px 0 0; font-size: 0.9375rem; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .aside { font-weight: 400; color: var(--muted); }

  .links { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0 0 10px; font-size: 0.875rem; }
  .links a { color: var(--navy); text-decoration: none; min-height: 28px; display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; }
  .links a:hover { text-decoration: underline; }
  .links .num { color: var(--muted); }

  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
  .actions .spacer { flex: 1; }
  form { margin: 0; }
  button {
    font: 600 0.875rem/1 Inter, system-ui, sans-serif; min-height: 40px; padding: 0 16px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--line-strong); background: var(--card); color: var(--ink); transition: background-color 150ms ease-out, filter 150ms ease-out;
  }
  button:hover { background: var(--sunk); }
  button:focus-visible { outline: 2px solid var(--sel); outline-offset: 2px; }
  button:active { filter: brightness(0.94); }
  button.primary { background: var(--gold); border-color: var(--gold); color: var(--on-gold); }
  button.primary:hover { filter: brightness(0.96); }
  button.danger { border-color: transparent; background: transparent; color: var(--destructive); padding: 0 10px; }
  button.danger:hover { background: var(--bad-bg); }
  @media (prefers-reduced-motion: reduce) { article, button { transition: none; } }

  .legend { position: absolute; z-index: 1; left: 12px; top: 12px; background: #fff; color: #0E1A2B; border-radius: 10px; padding: 8px 12px; font-size: 0.8125rem; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 6px 0 12px; vertical-align: -1px; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.3); }
  .legend i:first-child { margin-left: 0; }
</style></head>
<body>
<aside>
<h1>Moderation queue</h1>
<p class="sub"><span class="count">${items.length} waiting.</span> New members' first reports, held locations, and anything flagged or mostly disputed by visitors. Click one to see it on the map.</p>

${items.map((m) => card(db, m)).join("\n") || `<p class="empty">Nothing to review. New members' reports and flagged items land here.</p>`}
</aside>
${msg ? `<p class="toast${failed ? " failed" : ""}" role="${failed ? "alert" : "status"}">${esc(msg)}</p>` : ""}
<div id="map"><div class="legend"><i style="background:#0E2444"></i>Published MINFILE point<i style="background:#E8A317"></i>Reported point</div></div>
<script type="application/json" id="items">${data}</script>
<script src="${MAPLIBRE}/maplibre-gl.js"></script>
<script>${MAP_SCRIPT}</script>
</body></html>`;
}

// Runs in the browser: plain JS, no build step.
const MAP_SCRIPT = `
// The message has been shown; drop it from the URL so a refresh doesn't show it again.
if (location.search) history.replaceState(null, "", location.pathname);
const items = JSON.parse(document.getElementById("items").textContent);
const byId = new Map(items.map((i) => [i.id, i]));
const fc = (features) => ({ type: "FeatureCollection", features });
const point = (c, id) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: { id } });
// A search radius as a 64-gon: metres to degrees at this latitude.
const circle = ([lon, lat], m) => {
  const ring = [];
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * 2 * Math.PI;
    ring.push([lon + (m / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (m / 110540) * Math.sin(a)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
};
const bounds = (cs) => cs.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(cs[0], cs[0]));
const seen = new Set();
const pubs = items.filter((i) => i.pub && !seen.has(i.minfilno) && seen.add(i.minfilno)).map((i) => point(i.pub, i.id));
const pts = items.filter((i) => i.pt).map((i) => point(i.pt, i.id));

const map = new maplibregl.Map({ container: "map", style: "${STYLE_URL}", center: [-123.5, 53.5], zoom: 4.3, attributionControl: { compact: true } });
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));

// "style.load", not "load": the terrain style keeps "load" waiting on every tile in view.
// Compact credits open themselves as sources load; fold them once, so they don't cover a phone-sized map.
map.once("idle", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
map.once("style.load", () => {
  map.addSource("sel", { type: "geojson", data: fc([]) });
  map.addSource("pubs", { type: "geojson", data: fc(pubs) });
  map.addSource("pts", { type: "geojson", data: fc(pts) });
  map.addLayer({ id: "sel-fill", type: "fill", source: "sel", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#E8A317", "fill-opacity": 0.15 } });
  map.addLayer({ id: "sel-edge", type: "line", source: "sel", filter: ["==", "$type", "Polygon"], paint: { "line-color": "#E8A317", "line-width": 2 } });
  map.addLayer({ id: "sel-link", type: "line", source: "sel", filter: ["==", "$type", "LineString"], paint: { "line-color": "#0E2444", "line-width": 2, "line-dasharray": [2, 2] } });
  const dot = (color, r) => ({ "circle-color": color, "circle-radius": r, "circle-stroke-color": "#fff", "circle-stroke-width": 2 });
  map.addLayer({ id: "pubs", type: "circle", source: "pubs", paint: dot("#0E2444", 6) });
  map.addLayer({ id: "pts", type: "circle", source: "pts", paint: dot("#E8A317", 7) });
  for (const layer of ["pubs", "pts"]) {
    map.on("click", layer, (e) => select(e.features[0].properties.id, true));
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }
  const all = [...pubs, ...pts].map((f) => f.geometry.coordinates);
  if (all.length) map.fitBounds(bounds(all), { padding: 60, maxZoom: 12, duration: 0 });
});

function select(id, fromMap) {
  const it = byId.get(id);
  if (!it) return;
  document.querySelectorAll("article.sel").forEach((a) => a.classList.remove("sel"));
  const card = document.querySelector('article[data-id="' + CSS.escape(id) + '"]');
  if (card) {
    card.classList.add("sel");
    if (fromMap) card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const shapes = [];
  if (it.pub && it.pt) shapes.push({ type: "Feature", geometry: { type: "LineString", coordinates: [it.pub, it.pt] }, properties: {} });
  if (it.kind === "not_found" && it.pub && it.r) shapes.push(circle(it.pub, it.r));
  const src = map.getSource("sel");
  if (src) src.setData(fc(shapes));
  // Frame the mine: its published point, the reported point, and any search circle.
  const cs = [it.pub, it.pt].filter(Boolean).concat(...shapes.filter((s) => s.geometry.type === "Polygon").map((s) => s.geometry.coordinates[0]));
  if (cs.length) map.fitBounds(bounds(cs), { padding: 80, maxZoom: 16, duration: 1200 });
}

// A click anywhere on a card except its links and buttons.
document.querySelectorAll("article[data-id]").forEach((a) => {
  a.addEventListener("click", (e) => { if (!e.target.closest("a, button, form")) select(a.dataset.id, false); });
  a.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === a) select(a.dataset.id, false); });
});
`;
