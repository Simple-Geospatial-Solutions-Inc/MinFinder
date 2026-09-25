# minfinder-api

The backend for field reports: members' corrections and updates on existing MINFILE mines. It's plain Node (22.18+
runs the `.ts` files directly), with the built-in `node:sqlite`. It has three dependencies:
`jose` checks sign-in tokens, `sharp` handles photos and `zod` validates input. The rules,
thresholds and report status are in `src/rules.ts`.

```sh
pnpm --filter @workspace/minfinder-api start   # :8084, data in ./data
pnpm --filter @workspace/minfinder-api test    # node --test
```

Deployment uses systemd behind Caddy on the VPS. The one-time setup is in the header of
`deploy/minfinder-api.service`. After that, ship updates with `deploy/deploy.sh`. Staff
moderate at `https://api.sgss.ca/admin` (HTTP Basic, any username, the password is
`ADMIN_PASSWORD` in the service's env file; the page 404s while that's unset) or from the box
with `src/admin.ts`, whose commands are listed at the top of that file.

## API (`/v1`)

Every error is returned as `{ error, message }`, where `error` is a stable code the app can
branch on.

| Method and path | Auth | Notes |
|---|---|---|
| `GET health` | – | `{ ok: true }` |
| `GET config` | – | `min_app_version`, `submissions_enabled` (the kill switch), `limits` |
| `POST auth/apple`, `POST auth/google` | – | `{ id_token }` → `{ token }`. Send it as `Authorization: Bearer <token>`. |
| `GET attest/challenge` | ✔ | `{ challenge }`, single use, valid 5 minutes. For registering an App Attest key. |
| `POST attest/ios` | ✔ | `{ key_id, attestation, challenge }`: registers this install's App Attest key. |
| `POST submissions` | ✔ | See the next section. |
| `GET contributions?since=<cursor>` | – | `{ cursor, more, contributions, deleted }`. Call again while `more` is true. Keep `cursor` for the next sync. |
| `GET me/submissions` | ✔ | `{ contributions }`: the caller's own reports, including ones still pending review. |
| `POST contributions/:id/respond` | ✔ | A visitor's verdict, `{ value: 1 \| -1 \| 0, lat, lon, accuracy_m, captured_at }` (0 withdraws it), or `{ helpful: true \| false }` on a note. See "Status". |
| `POST contributions/:id/report` | ✔ | An abuse flag, `{ reason }`: `spam`, `inappropriate`, `photo_not_this_site`, `dangerous` or `other`. Two hide the report for staff. |
| `GET photos/:id.jpg`, `GET photos/:id_t.jpg` | – / ✔ | The full photo or a 480 px thumbnail. A report that's pending or hidden only shows photos to its author. |
| `POST contributions/:id/block` | ✔ | Hides everything by that report's author from the caller. The author is never told. |
| `GET me/blocks` | ✔ | `{ authors, ids }`: how many members the caller blocked, and the reports to hide. |
| `DELETE me/blocks` | ✔ | Unblocks everyone. |
| `DELETE me` | ✔ | Deletes the account. Its reports become tombstones and its photos are deleted. |

### Status

Each report carries a `status` worked out from on-site visits, never from a score:
`pending` (probation or a hold), `unconfirmed`, `disputed`, `collapsed`, `confirmed`, `verified`
(staff) or `hidden` (two abuse flags). The author's own capture is the first visit. A verdict is
stored only when its fix (±30 m or better, under 30 days old) puts the responder within 75 m of
a located working, or inside a `not_found`'s search radius of the published spot; otherwise it's
refused with `not_on_site`. Each visit's weight halves every two years. Confirmed needs two
confirms and over 2/3 agreement; collapsed is two or more visits and under 1/3. Notes are never
confirmed: `helpful` only orders them.

### Sensitive areas

A `location` whose pin is inside a provincial park, ecological reserve, protected area,
conservancy or First Nations reserve is stored as pending whatever the account's history, and
its author sees `held_for` (e.g. `"Provincial park: GARIBALDI PARK"`) until staff approve it on
/admin. Boundaries are in `assets/sensitive-areas.json`, built from BC's open WFS by
`node scripts/build-sensitive-areas.ts` (rerun when boundaries change, then deploy).

### Device attestation

Submissions and responses may carry `X-Attest`, bound to the exact body sent (the `data` part for a
submission): `ios <key_id> <assertion>` from App Attest, or `android <token>` from a Play
Integrity standard request whose request hash is the body's SHA-256 in hex. Responses include
`attest`, the verdict. `ATTESTATION` in the env sets the policy: `off`, `log` (the default:
record the verdict on the report, shown on /admin, never refuse) or `enforce` (refuse with
`attestation_required`, `attestation_failed`, `attest_key_unknown` (register a new key and
retry) or 503 `attestation_unavailable`). Enforce only once every build in use has the module
and comes from the stores: Play doesn't recognise sideloaded or EAS internal builds.

### `POST submissions`

The request is multipart: a `data` JSON part, plus up to three `photo` parts on a `location` or
`not_found` (a `note` takes none). Every `data` has `id` (a UUID the client generates, which
makes retries safe), `kind`, `minfilno`, and optionally `visit_id` (a UUID shared by the points
from one outing) and `text`. Then, by kind:
- `location`: `lat`, `lon` (the pin), `user_lat`, `user_lon`, `accuracy_m`, `mocked: false`,
  `captured_at` (epoch ms, from the fix), `label` (`adit`, `shaft`, `portal`, `trench`, `dump`,
  `headframe`, `ruins` or `other`), `far_ack?` and `safety_ack: true`.
- `not_found`: the same fix fields without `lat`/`lon`, plus `search_radius_m` (50, 150 or 300).
- `note`: `text` is required.

Published MINFILE points come from `assets/minfile-points.json`, built from the app's
`minfile.db` by `node scripts/build-minfile-points.ts` (rerun when that database is rebuilt).

| Status | Meaning |
|---|---|
| 201 | Created. |
| 200 | This `id` was already stored; the response is the stored report. |

Rejections, grouped by status. The server returns the `error` codes below:

| Status | `error` codes |
|---|---|
| 400 | `invalid`, `photos` |
| 409 | `photo_reused`, `id_taken` |
| 422 | `unknown_mine`, `gps_inaccurate`, `outside_bc`, `pin_too_far`, `far_unconfirmed`, `different_mine`, `not_at_published`, `captured_in_future`, `capture_too_old`, `impossible_travel`, `not_an_image` |
| 429 | `daily_limit` |

`far_unconfirmed` (over 300 m from the published point) and `different_mine` (over 10 km) include
`distance_m`. The app should ask the user whether it's the same mine and resend with
`far_ack: true`.
