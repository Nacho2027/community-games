# Platform adapters

One codebase, one rules engine, three surfaces. Game rules never live in a platform adapter.

## The seam

`src/adapters/index.js` is the only place a platform difference is allowed:

```js
load()                  -> Promise<state>
save(state)             -> Promise<boolean>
submit(gameId, action)  -> Promise<outcome>
```

- `createLocalAdapter({ storage })` - browser play. Still routes through `play()` in
  `src/games/index.js`, so local and hosted play use identical rules.
- `createHttpAdapter({ endpoint })` - forwards the raw action to an authoritative server and
  trusts only what comes back. The client never scores, validates ownership, or decides winners.
- `detectAdapter()` - picks HTTP when `globalThis.__GAMES_API__` is set, otherwise local.

Both adapters are covered by `tests/adapters.test.js`, including duplicate attempts,
network failure, and tampered local state.

## Reddit Devvit

`reddit/` is an upload-ready Devvit app:

- `reddit/devvit.json` points at the built `../dist` client and `server/index.js`.
- `reddit/server/index.js` is authoritative: identity comes from `reddit.getCurrentUser()`,
  progress lives in Redis (localStorage is wiped on every app update), and
  `GET /api/state`, `GET /api/round`, `POST /api/play` all delegate scoring to `play()`.
- `payments.enabled` stays `false` until the Reddit Earn Terms are accepted and products are
  approved. Paid items must be cosmetic or convenience only.

## Discord Activity

Reuse the same `dist` bundle inside the Activity iframe and switch `__GAMES_API__` to the
Activity host. Key multiplayer rooms by `instanceId`, validate the launch session with the
Activity Instance API before trusting it, and check entitlements server-side.

## Roblox

Not attempted. Roblox needs a separate Luau client and its own networking; only the game
design, balance constants, and content shape would transfer.

## Deployment gates

1. `npm run verify` passes (tests + production build).
2. No public round payload contains an answer, culprit, or outcome.
3. One scored action per player per period, enforced in `src/engine/actions.js`.
4. Secrets, identities, and scoring stay server-side.
5. Each platform is playtested in its own development environment before release.
