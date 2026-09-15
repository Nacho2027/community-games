# Community Games

Five daily games that run as one codebase and one shared rules engine.

| Game | Cadence | Max points | Decision |
| --- | --- | --- | --- |
| Daily Numbers | daily | 10 | Use three pool numbers and two operators to hit the target |
| Prediction League | daily | 100 | Call a yes/no outcome and state your confidence |
| Faction War | daily | 25 | Back one of three factions against the crowd |
| Daily Mystery | daily | 15 | Accuse the one suspect every clue fails to exclude |
| Community Market | daily | 40 | Trade three goods within budget and capacity |

## Quick start

```bash
npm install
npm run verify     # 108 tests, then a production build into dist/
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

### Design invariants

1. Rounds are deterministic: the same period key produces the same content for everyone.
2. Public round payloads never contain the answer, culprit, or outcome.
3. `submit()` never throws; malformed input returns `accepted: false`.
4. Points are always integers within `[0, meta.maxPoints]`.
5. Every round is provably solvable, and a test proves it.

## Publishing

See [PUBLISH.md](PUBLISH.md) for the web, Reddit Devvit, and Discord Activity steps plus
the monetization checklists.
