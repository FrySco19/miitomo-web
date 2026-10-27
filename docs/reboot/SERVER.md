# Reboot — our central backend

Status: **contracts only (R1)**. Implementation is planned for R10, realtime for R11.

```
Web client  ──HTTPS/JSON──▶  Our API  ──▶  Database
     ▲                          │
     └──── WebSocket / SSE ◀────┘  Realtime / event system (presence, notifications)
```

## Non-negotiables

- **Never Nintendo.**
  - No Nintendo server, account or authentication.
  - `createServerProvider` throws if it is given a Nintendo host.
  - The Nintendo credentials in the APK (`assets/npf.json`) are never read, copied or reused.
- **No secrets in the browser bundle.**
  - Authentication is a server-issued session in an HttpOnly cookie (`credentials: 'include'`).
  - The client holds no API key.
- **All client input is untrusted.** The server owns and validates:
  - ids, timestamps and counters (reactions, comments, stats);
  - ownership and room permissions;
  - capacity;
  - score plausibility.
- **Moderation-ready writes.** Every write can be refused with one of `RATE_LIMITED`, `BLOCKED`, `MODERATED`,
  `FORBIDDEN`, `ROOM_FULL`.

## Contracts v1

The contracts are defined in `client/web/src/reboot/api/contracts.ts`: types, `RebootApi`, `ENDPOINTS` and
`RealtimeEvent`.

| Domain | Endpoints |
|---|---|
| accounts | `GET /v1/me` |
| profiles | `GET /v1/profiles/:id`, `PATCH /v1/me/profile` |
| friends | `GET /v1/friends`, `POST`/`PUT`/`DELETE /v1/friends/:id` |
| rooms | `GET /v1/rooms/:id`, `GET /v1/rooms?kind=public`, `PATCH /v1/rooms/:id` |
| presence | `POST`/`PUT`/`DELETE /v1/rooms/:id/presence` + realtime `presence.join` / `presence.move` / `presence.leave` |
| posts | `GET /v1/feed`, `GET /v1/profiles/:id/posts`, `POST /v1/posts`, `DELETE /v1/posts/:id` |
| reactions | `GET /v1/reactions` (server-side, extensible table), `PUT /v1/posts/:id/reactions` |
| comments | `GET`/`POST /v1/posts/:id/comments`, `DELETE /v1/comments/:id` |
| games / scores | `GET /v1/games`, `POST /v1/scores` (server re-validates), `GET /v1/games/:id/leaderboard` |
| rewards | `GET /v1/me/rewards` |
| events | `GET /v1/events` |
| notifications | `GET /v1/me/notifications`, `POST /v1/me/notifications/read` + realtime `notification` |
| safety | `POST /v1/reports`, `POST`/`DELETE /v1/blocks/:id`, `PUT /v1/mutes/:id`, `PATCH /v1/me/privacy` |

Every response is `Result<T>`, either `{ ok: true, value }` or `{ ok: false, error: { code, message, retryAfterMs? } }`.
Every list is paginated with `Page<T>`, made of `items` plus a `next` cursor.

## Providers

| Provider | Status | Behaviour |
|---|---|---|
| `createLocalProvider()` | Now | Simulates the server in this browser. Methods are added phase by phase; a missing method answers `NOT_CONFIGURED` with the phase that adds it. Safety (report, block, mute, privacy) and rate limits are real already |
| `createServerProvider(baseUrl)` | Ready | Plain `fetch` over `ENDPOINTS`. `baseUrl` null → `NOT_CONFIGURED`. HTTP errors are mapped to `ApiError` codes |

The Mii travels as the user's own FFL CharInfo (base64), which the user made in the editor. No Nintendo data is
fetched.

## Next decisions (R10)

These are open and will be decided in R10:

- stack;
- hosting;
- account model (e-mail / passkey);
- data retention;
- moderation tooling;
- age policy.

The user's usual stack (Next.js + Supabase + Vercel) is a natural fit. Supabase covers Postgres, auth, realtime and
storage for Miifoto images. That choice is the user's to make.
