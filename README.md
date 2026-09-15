# Community Games

Five daily games that run as one codebase and one shared rules engine.

**Live: <https://nacho2027.github.io/community-games/>** (auto-deployed from `main` by GitHub Actions)

| Game | Cadence | Max points | Decision |
| --- | --- | --- | --- |
| Daily Numbers | daily | 10 | Use three pool numbers and two operators to hit the target |
| Prediction League | daily | 100 | Forecast a fact about today's Numbers solution, with stated confidence |
| Faction War | daily | 25 | Read the opening turn, then commit to the faction you think takes the war |
| Daily Mystery | daily | 15 | Cross-reference every alibi, then name the suspect the evidence cannot rule out |
| Community Market | daily | 20 | Trade three goods within budget and holding capacity |

## Quick start

```bash
npm install
npm run verify     # 162 tests, then a production build into dist/
npm run dev        # play locally
```

## How it is built

- `src/games/<id>.js` - one module per game exporting `meta`, `roundFor(periodKey)`, `submit(round, action)`.
  Rules and scoring live here and nowhere else.
- `src/engine/actions.js` - the authoritative ledger: one scored action per player per period,
  duplicate submissions never pay twice, and invalid actions never burn the slot.
- `src/games/index.js` - `play(ledger, gameId, action)` is the single entry point every
  platform adapter calls.
- `src/adapters/index.js` - local and HTTP adapter implementations behind one seam, so the
  browser, Reddit, and Discord all route actions through the same server-authoritative path.
- `src/ui/` - presentation only. The UI cannot award points.

### Retention and acquisition

- `src/engine/streak.js` tracks consecutive days played and builds a spoiler-free
  copy-paste result. Engagement-based platform payouts are driven by returning
  players, so the daily streak is the money mechanism, not decoration.

### Design invariants

1. Rounds are deterministic: the same period key produces the same content for everyone.
2. Public round payloads never contain the answer, culprit, or outcome.
3. `submit()` never throws; malformed input returns `accepted: false`.
4. Points are always integers within `[0, meta.maxPoints]`.
5. Every round is provably solvable, and a test proves it.
6. `meta.maxPoints` is actually reachable, and a test proves it.
7. No game may be winnable by reading the public board. A test pins each game's
   difficulty band.

### Defects found by measuring, after the games already "worked"

Every game passed its tests while still being broken as a game. Measurement caught all
three; each now has a regression test:

| Game | Defect | Evidence | Fix |
| --- | --- | --- | --- |
| Community Market | `capacity` counted buy and sell legs together | best possible day scored **8 of 40** | capacity is a holding limit; ceiling is 20 and proven reachable |
| Prediction League | outcome came from an independent random draw | **213 yes / 187 no** over 400 days — a coin flip | questions resolve against the day's Numbers solution; every template tested to a 20-80% base rate |
| Faction War | every turn's crowd votes were published | naive "back the leader" won **200/200 = 100%** | only the opening turn is public; reading it now wins **69.5%**, blind picks 33.7% |
| Daily Mystery | clues named three of four suspects outright | the answer was simply the **one name not printed** — 3 named/day, every day | clues describe conditions, suspects publish alibis and items; **0 clues name anyone** |
| Prediction League | scoring was `correct ? confidence : 5` | expected value rose with confidence, so **always answering 100% was optimal** and the slider was decorative | proper scoring rule; optimal confidence now tracks each question's true rate (52%→55, 73%→75) |

### Cross-game design

Driving games from real puzzle state is what makes them worth returning to:

- Prediction questions resolve against the same day's Numbers puzzle solution, so the
  answer is knowable by reasoning but is not visible on the board. Every template is
  tested to have a base rate between 20% and 80%, and to resolve both ways across days.
- The market's capacity is a holding limit, not a trade-volume limit, so a perfect day
  reaches the advertised ceiling.

## Publishing

See [PUBLISH.md](PUBLISH.md) for the web, Reddit Devvit, and Discord Activity steps plus
the monetization checklists.

### Worst-case hardening

A daily game is only as good as its worst day: one degenerate round is a broken day for
every player at once. `tests/horizon.test.js` sweeps ten years rather than a handful of
periods and asserts, for all five games on all 3660 days:

- no answer-bearing field ever appears in a public round
- Daily Numbers is always solvable
- Daily Mystery always narrows to exactly one suspect, and no clue ever names one
- Community Market always leaves a profitable trade within its ceiling
- points are always integers inside `[0, meta.maxPoints]`, for every legal setting
- rounds stay deterministic
