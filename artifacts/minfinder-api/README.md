# minfinder-api

The backend for Community Mines, the user-submitted mines feature. It's plain Node (22.18+
runs the `.ts` files directly), with the built-in `node:sqlite`. It has three dependencies:
`jose` checks sign-in tokens, `sharp` handles photos and `zod` validates input. The rules,
thresholds and trust tier are in `src/rules.ts`.

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
| `GET mines?since=<cursor>` | – | `{ cursor, more, mines, deleted }`. Call again while `more` is true. Keep `cursor` for the next sync. |
| `GET me/submissions` | ✔ | The caller's own submissions, including ones still pending review. |
| `POST mines/:id/vote` | ✔ | `{ value: -1 \| 0 \| 1, lat?, lon?, accuracy_m? }`. Sending a position within 150 m makes it an on-site vote. |
| `POST mines/:id/report` | ✔ | `{ reason }`: `not_a_mine`, `wrong_location`, `photo_not_this_site`, `duplicate`, `inappropriate`, `dangerous` or `other`. |
| `GET photos/:id.jpg`, `GET photos/:id_t.jpg` | – / ✔ | The full photo or a 480 px thumbnail. A mine that's pending or hidden only shows photos to its author. |
| `POST mines/:id/block` | ✔ | Hides everything by that mine's author from the caller. The author is never told. |
| `GET me/blocks` | ✔ | `{ authors, mine_ids }`: how many members the caller blocked, and the mines to hide. |
| `DELETE me/blocks` | ✔ | Unblocks everyone. |
| `DELETE me` | ✔ | Deletes the account. Its submissions become tombstones and its photos are deleted. |

### Sensitive areas

A submission whose pin is inside a provincial park, ecological reserve, protected area,
conservancy or First Nations reserve is stored as pending whatever the account's history, and
its author sees `held_for` (e.g. `"Provincial park: GARIBALDI PARK"`) until staff approve it on
/admin. Boundaries are in `data/sensitive-areas.json`, built from BC's open WFS by
`node scripts/build-sensitive-areas.ts` (rerun when boundaries change, then deploy).

### Device attestation

Submissions and votes may carry `X-Attest`, bound to the exact body sent (the `data` part for a
submission): `ios <key_id> <assertion>` from App Attest, or `android <token>` from a Play
Integrity standard request whose request hash is the body's SHA-256 in hex. Responses include
`attest`, the verdict. `ATTESTATION` in the env sets the policy: `off`, `log` (the default:
record the verdict on the mine, shown on /admin, never refuse) or `enforce` (refuse with
`attestation_required`, `attestation_failed`, `attest_key_unknown` (register a new key and
retry) or 503 `attestation_unavailable`). Enforce only once every build in use has the module
and comes from the stores: Play doesn't recognise sideloaded or EAS internal builds.

### `POST submissions`

The request is multipart:
- `data` is a JSON part with these fields: `id` (a UUID the client generates, which makes
  retries safe), `lat`, `lon`, `user_lat`, `user_lon`, `accuracy_m`, `mocked: false`,
  `captured_at` (epoch ms), `type`, `name?`, `commodity?`, `hazards[]`, `notes?` and
  `safety_ack: true`.
- One to three `photo` parts.

| Status | Meaning |
|---|---|
| 201 | Created. |
| 200 | This `id` was already stored; the response is the stored mine. |

Rejections, grouped by status. The server returns the `error` codes below:

| Status | `error` codes |
|---|---|
| 409 | `too_close_to_yours`, `photo_reused`, `id_taken`, `duplicate` |
| 422 | `gps_inaccurate`, `outside_bc`, `pin_too_far`, `captured_in_future`, `capture_too_old`, `impossible_travel`, `not_an_image` |
| 429 | `daily_limit` |

A `duplicate` response includes a `mine_id`. The app should offer to confirm that mine
(an on-site upvote) instead of submitting a new one.
