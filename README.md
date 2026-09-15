# Community Games

Five daily games running on one codebase and one shared rules engine.

**Live: <https://nacho2027.github.io/community-games/>** (auto-deployed from `main` by GitHub Actions)

| Game | Mode | Attempts | Max points | What you do |
| --- | --- | --- | --- | --- |
| Daily Numbers | solve | 6 | 100 | Tap three pool numbers and two operators to hit the target |
| Prediction League | series | 3 | 100 | Call three facts about today's Numbers puzzle, each with your confidence |
| Faction War | series | 5 | 100 | Read each turn's result and call the next one before the war closes |
| Daily Mystery | solve | 3 | 100 | Cross-reference alibis and items, then name the suspect the evidence cannot clear |
| Community Market | solve | 3 | 100 | Buy and sell three goods within budget and holding capacity |

## Quick start

```bash
npm install
npm run verify     # 190 tests, then a production build into dist/
npm run dev        # play locally
```

## The play loop

The first version gave every game exactly one guess per day with **no feedback**, and a test
enforced it ("a wrong answer still consumes the day"). That deleted the game. One blind
guess is a quiz, not a loop: there is nothing to learn between attempts and nothing to be
good at. Wordle's six guesses with colour-coded feedback *are* the game.

Every game now runs on capped attempts with per-guess feedback, in one of two shapes:

- `mode: "solve"` — a puzzle. It ends when it is solved or when attempts run out, and using
  fewer attempts pays more. Solving on the first attempt pays the full ceiling.
- `mode: "series"` — a run of independent calls. Every attempt is played, and each correct
  call pays an equal share, so a perfect run reaches the ceiling exactly.

Capping attempts is also a stronger anti-cheat than forbidding retries: brute force is
bounded rather than unpoliced. A malformed or illegal move costs nothing; a well-formed but
wrong move always costs an attempt.

## How it is built

- `src/games/<id>.js` - one module per game exporting `meta`, `roundFor(periodKey)`, and
  `judge(round, action, context)`. Rules live here and nowhere else. A game judges a move;
  it does not score it.
- `src/engine/progress.js` - the attempt loop. It owns attempts, termination, and scoring:
  `submitGuess()` folds a judged move into the ledger, points are always recomputed from
  history, and a finished period can never be replayed for points.
- `src/games/index.js` - `guess(ledger, gameId, action, date)` is the single entry point
  every platform adapter calls.
- `src/adapters/index.js` - local and HTTP adapters behind one seam, so the browser, Reddit,
  and Discord route moves through the same server-authoritative path.
- `src/ui/` - presentation only. The UI cannot award points and never computes a score.

### Presentation

The first UI was a form. Every game was a `<select>` and a number input with a Submit
button, results were rendered with `JSON.stringify(reveal)`, and there was no motion
anywhere in the stylesheet. It read as a settings page and printed developer output.

It is now direct manipulation: tap pool tiles and watch a running total climb, tap a clue to
cross out the suspects it rules out, step quantities on a market row, commit, and watch the
attempt fill in and the verdict land.

### Retention and acquisition

- `src/engine/streak.js` tracks consecutive days played and builds a spoiler-free
  copy-paste result. Engagement-based platform payouts are driven by returning players, so
  the daily streak is the money mechanism, not decoration.

### Design invariants

1. Rounds are deterministic: the same period key produces the same content for everyone.
2. Public round payloads never contain the answer, culprit, or outcome.
3. `judge()` never throws; malformed input returns `accepted: false`.
4. Points are always integers within `[0, meta.maxPoints]`.
5. Every round is provably solvable, and a test proves it.
6. `meta.maxPoints` is actually reachable, and a test proves it.
7. No game may be winnable by reading the public board. A test pins each game's difficulty
   band.
8. A malformed move costs no attempt; a well-formed wrong move always costs one.

## Defects found by measuring, after the games already "worked"

Every one of these passed a green test suite first. The suite measured provable correctness
and balance; it never asked whether the thing was playable. Each now has a regression test.

| Area | Defect | Evidence | Fix |
| --- | --- | --- | --- |
| The loop | one guess per day with no feedback, enforced by a test | nothing to learn between attempts; a wrong answer ended the day | capped attempts with per-guess feedback; fewer attempts pays more |
| Presentation | results rendered with `JSON.stringify(reveal)` | players read raw JSON after every guess | boards render the move, the feedback, and the verdict |
| Presentation | nested child arrays were stringified, not appended | the whole board rendered as the text `[object HTMLElement],…` | `el()` flattens nested arrays |
| Community Market | `capacity` counted buy and sell legs together | best possible day scored **8 of 40** | capacity is a holding limit; the ceiling is proven reachable |
| Prediction League | outcome came from an independent random draw | **213 yes / 187 no** over 400 days — a coin flip | questions resolve against the day's Numbers solution, every template tested to a 20-80% base rate |
| Prediction League | scoring was `correct ? confidence : 5` | expected value rose with confidence, so **always answering 100% was optimal** and the slider was decorative | proper scoring rule; optimal confidence tracks each question's true rate (52%→55, 73%→75) |
| Faction War | every turn's crowd votes were published | naive "back the leader" won **200/200 = 100%** | only the opening turn is public; reading it wins about **69.5%**, blind picks about 33.7% |
| Daily Mystery | clues named three of four suspects outright | the answer was simply the **one name not printed**, 3 named per day every day | clues describe conditions; **0 clues name anyone** |

### Cross-game design

Driving games from real puzzle state is what makes them worth returning to:

- Prediction questions resolve against the same day's Numbers puzzle solution, so the answer
  is knowable by reasoning but is not visible on the board. Every template is tested to have
  a base rate between 20% and 80%, and to resolve both ways across days.
- The market's capacity is a holding limit, not a trade-volume limit, so a perfect day
  reaches the advertised ceiling.
- A wrong accusation in Daily Mystery clears that suspect rather than ending the day, and
  with four suspects and three attempts the case still cannot be brute forced.

## Publishing

See [PUBLISH.md](PUBLISH.md) for the web, Reddit Devvit, and Discord Activity steps plus the
monetization checklists.

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
