# Community Games

Five daily games that run as one codebase and one shared rules engine.

**Live: <https://nacho2027.github.io/community-games/>** (auto-deployed from `main` by GitHub Actions)

| Game | Cadence | Max points | Decision |
| --- | --- | --- | --- |
| Daily Numbers | daily | 10 | Use three pool numbers and two operators to hit the target |
| Prediction League | daily | 100 | Forecast a fact about today's Numbers solution, with stated confidence |
| Faction War | daily | 25 | Back one of three factions against the crowd |
| Daily Mystery | daily | 15 | Accuse the one suspect every clue fails to exclude |
| Community Market | daily | 20 | Trade three goods within budget and holding capacity |

## Quick start

```bash
npm install
npm run verify     # 138 tests, then a production build into dist/
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
6. `meta.maxPoints` is actually reachable, and a test proves it. Two games shipped
   broken scales before this was enforced: the market could score at most 8 of 40,
   and prediction resolved by coin flip instead of from the puzzle.

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
