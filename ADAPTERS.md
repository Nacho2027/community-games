# Platform adapters

One codebase, one rules engine, three surfaces. Game rules never live in a platform adapter.

## The seam

`src/server/api.js` holds the authoritative HTTP logic once, platform-neutral:

```js
createApi({
  identify, loadLedger, saveLedger,
  recordScore, topScores, playerRank, boardStats,  // optional: daily boards
  now,
})
  -> { state(), round({ gameId }), play({ gameId, action }), leaderboard({ gameId }) }
```

Each handler returns `{ status, body }`. Hosts supply identity, storage, and boards.
Covered by `tests/server.test.js` and `tests/leaderboard.test.js`, including 401s, unknown
games, duplicate attempts, malformed actions, per-player isolation, and spoiler safety.

`src/adapters/index.js` is the client seam:

```js
load()                  -> Promise<state>
save(state)             -> Promise<boolean>
submit(gameId, action)  -> Promise<outcome>
leaderboard(gameId)     -> Promise<board>
```

- `createLocalAdapter({ storage })` - browser play. Still routes through `play()` in
  `src/games/index.js`, so local and hosted play use identical rules.
- `createHttpAdapter({ endpoint })` - forwards the raw action to an authoritative server and
  trusts only what comes back. The client never scores, validates ownership, or decides winners.
- `detectAdapter()` - picks HTTP when `globalThis.__GAMES_API__` is set, otherwise local.

Both adapters are covered by `tests/adapters.test.js`, including duplicate attempts,
network failure, and tampered local state. The local adapter reports `available: false` for
every board, because a browser with no server has no shared board to show.

## Daily boards

Each game keeps its **own** board. Games are scored on different scales and reward
different skills, so a combined board would rank the games against each other instead of
ranking players.

The host supplies up to four functions; the API owns ranking, sanitising, and limits:

| Function | Purpose |
| --- | --- |
| `recordScore({ gameId, periodKey, player, points, attemptsUsed, solved, at })` | called once, when a period finishes |
| `topScores({ gameId, periodKey, limit })` | raw rows, unordered; the API ranks them |
| `playerRank({ gameId, periodKey, player })` | 1-based rank, for "you are rank 47" |
| `boardStats({ gameId, periodKey })` | `{ played, solved, firstTry }` |

Ranking, applied by `rankScores` in the API: more points first, then fewer attempts, then
earlier submission, then name. Ranking in one place means every platform agrees.

A board is keyed by game **and** period, so it resets daily and no two games share a board.
Only `topScores` is required; without it the API reports `available: false` and the UI shows
an honest solo state rather than an empty table that looks like a ranking nobody entered.

## Reddit Devvit

`reddit/` is an upload-ready Devvit app:

- `reddit/devvit.json` points at the built client in `public/` and the bundled server at
  `dist-server/index.js`.
- `reddit/server/index.js` wires Reddit identity, Redis storage, and the daily boards into
  `createApi` (localStorage is wiped on every app update, so progress must live in Redis).
  This is the production board, and it costs nothing extra: the subreddit is the audience.
- `payments.enabled` stays `false` until the Reddit Earn Terms are accepted and products are
  approved. Paid items must be cosmetic or convenience only.

## Discord Activity

`discord/server/index.js` wires the Activity session and storage into the same `createApi`.

- Reuse the same `dist` bundle inside the Activity iframe and set `__GAMES_API__` to the
  Activity host.
- Resolve the participant from the verified Activity session, never from client input.
- Key multiplayer rooms by `instanceId`.
- Check entitlements server-side before granting any paid reward.
- Swap the in-memory ledger map for durable storage before production.

## Roblox

Not attempted. Roblox needs a separate Luau client and its own networking; only the game
design, balance constants, and content shape would transfer.

## Deployment gates

1. `npm run verify` passes (tests + build + a smoke test of the shipped bundle).
2. No public round payload contains an answer, culprit, or outcome.
3. Capped attempts per player per period, enforced in `src/engine/progress.js`: a finished
   period cannot be replayed for points, and a wrong move costs an attempt.
4. Secrets, identities, and scoring stay server-side. A board member is a player id, never a
   display name.
5. A score is recorded once, on finish, so a board cannot be padded by replaying a period.
6. Each platform is playtested in its own development environment before release.
