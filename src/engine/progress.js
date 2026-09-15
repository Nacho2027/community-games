// The play loop.
//
// This replaces the original one-shot model, where a wrong answer consumed the whole day
// and every game was a single blind guess. One guess with no feedback is a quiz, not a
// game: there is nothing to learn between attempts and nothing to be good at.
//
// Every game now runs on attempts, capped, with per-guess feedback the player can see.
// Capping attempts is also a stronger anti-cheat than the old "you only get one" rule:
// brute force is bounded rather than forbidden, and using fewer attempts pays more.
//
// Two loop shapes cover every game:
//   "solve"  - a puzzle. Ends the moment it is solved, or when attempts run out.
//              Fewer attempts pays more.
//   "series" - a run of independent calls. Every attempt is played. Each correct call
//              pays an equal share, so a perfect run pays exactly maxPoints.

const HISTORY_LIMIT = 200;

export const MODES = ["solve", "series"];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function keyFor(gameId, periodKey) {
  return `${gameId}:${periodKey}`;
}

function sanitizeGuess(raw) {
  if (!isPlainObject(raw)) return null;
  const label = nonEmptyString(raw.label);
  if (!label) return null;
  const state = ["correct", "wrong", "close"].includes(raw.state)
    ? raw.state
    : "wrong";
  return {
    label,
    state,
    detail: typeof raw.detail === "string" ? raw.detail : null,
    at: nonEmptyString(raw.at) ?? new Date(0).toISOString(),
  };
}

function sanitizeEntry(raw) {
  if (!isPlainObject(raw)) return null;
  const gameId = nonEmptyString(raw.gameId);
  const periodKey = nonEmptyString(raw.periodKey);
  if (!gameId || !periodKey) return null;

  const guesses = (Array.isArray(raw.guesses) ? raw.guesses : [])
    .map(sanitizeGuess)
    .filter(Boolean);

  return {
    gameId,
    periodKey,
    guesses,
    attemptsUsed: guesses.length,
    solved: raw.solved === true,
    finished: raw.finished === true,
    points: Math.max(0, toInt(raw.points)),
  };
}

export function createLedger(initial = {}) {
  const source = isPlainObject(initial) ? initial : {};

  const progress = {};
  if (isPlainObject(source.progress)) {
    for (const [key, entry] of Object.entries(source.progress)) {
      const safe = sanitizeEntry(entry);
      if (safe && key === keyFor(safe.gameId, safe.periodKey))
        progress[key] = safe;
    }
  }

  const history = (Array.isArray(source.history) ? source.history : [])
    .map(sanitizeEntry)
    .filter(Boolean)
    .slice(0, HISTORY_LIMIT);

  // Points are always recomputed from the ledger, never trusted as a stored number.
  const points = history.reduce((sum, entry) => sum + entry.points, 0);

  return { progress, points, history };
}

export function progressFor(ledger, gameId, periodKey) {
  return createLedger(ledger).progress[keyFor(gameId, periodKey)] ?? null;
}

export function canGuess(ledger, gameId, periodKey) {
  const entry = progressFor(ledger, gameId, periodKey);
  return !entry?.finished;
}

// Solve mode: solving on the first try pays the ceiling, the last attempt still pays
// something so a late solve never feels worthless.
export function attemptPoints(maxPoints, attemptsUsed, maxAttempts) {
  const ceiling = Math.max(0, toInt(maxPoints));
  const used = Math.max(1, toInt(attemptsUsed, 1));
  const allowed = Math.max(1, toInt(maxAttempts, 1));
  const capped = Math.min(used, allowed);
  return Math.max(0, Math.round((ceiling * (allowed - capped + 1)) / allowed));
}

// Series mode: equal share per call. The final call absorbs the rounding remainder so a
// perfect run lands exactly on the ceiling rather than a point or two short.
export function sharePoints(maxPoints, attempt, maxAttempts, correct) {
  if (!correct) return 0;
  const ceiling = Math.max(0, toInt(maxPoints));
  const allowed = Math.max(1, toInt(maxAttempts, 1));
  const index = Math.min(Math.max(1, toInt(attempt, 1)), allowed);
  const perCall = Math.floor(ceiling / allowed);
  if (index === allowed) return ceiling - perCall * (allowed - 1);
  return perCall;
}

function rejection(ledger, reason) {
  return {
    accepted: false,
    reason,
    correct: false,
    duplicate: false,
    finished: false,
    points: 0,
    attemptsUsed: 0,
    attemptsLeft: 0,
    feedback: null,
    reveal: null,
    state: ledger,
  };
}

// Judge one move against a round and fold the result into the ledger.
//
// `judge(round, action, context)` is supplied by the game and owns the rules. It receives
// the 1-based attempt number so multi-round games can resolve the right turn, and it must
// not throw. A rejected move is malformed or illegal: it costs nothing and uses no attempt.
export function submitGuess(ledger, request = {}) {
  const current = createLedger(ledger);
  const {
    gameId,
    periodKey,
    round,
    action,
    judge,
    mode = "solve",
    maxAttempts,
    maxPoints,
    now,
  } = isPlainObject(request) ? request : {};

  const at = nonEmptyString(now) ?? new Date().toISOString();

  if (!nonEmptyString(gameId)) return rejection(current, "invalid-game-id");
  if (!nonEmptyString(periodKey))
    return rejection(current, "invalid-period-key");
  if (typeof judge !== "function") return rejection(current, "missing-judge");

  const shape = MODES.includes(mode) ? mode : "solve";
  const allowed = Math.max(1, toInt(maxAttempts, 1));
  const key = keyFor(gameId, periodKey);
  const existing = current.progress[key] ?? null;

  if (existing?.finished) {
    return {
      ...rejection(current, "already-finished"),
      duplicate: true,
      state: current,
    };
  }

  const attempt = (existing?.attemptsUsed ?? 0) + 1;

  let verdict;
  try {
    verdict = judge(round, action, { attempt, maxAttempts: allowed });
  } catch {
    return rejection(current, "judge-failed");
  }

  if (!isPlainObject(verdict) || verdict.accepted !== true) {
    const reason =
      isPlainObject(verdict) && typeof verdict.reason === "string"
        ? verdict.reason
        : "rejected";
    return rejection(current, reason);
  }

  const correct = verdict.correct === true;
  const guess = sanitizeGuess({
    label: verdict.feedback?.label,
    state: correct ? "correct" : (verdict.feedback?.state ?? "wrong"),
    detail: verdict.feedback?.detail,
    at,
  });

  if (!guess) return rejection(current, "missing-feedback");

  const guesses = [...(existing?.guesses ?? []), guess];
  const attemptsUsed = guesses.length;

  // A "series" always plays out every attempt; a "solve" stops on the first success.
  const finished =
    shape === "series"
      ? attemptsUsed >= allowed
      : correct || attemptsUsed >= allowed;

  // `delta` is what this move earned on its own, so the UI can animate the gain rather
  // than the running total. `points` is the cumulative total stored on the entry.
  //
  // In series mode the per-call share is the ceiling regardless of correctness, and the
  // game's optional `weight` in [0,1] is the quality signal. This ordering matters: paying
  // zero for an incorrect call first, then scaling by weight, multiplies the weight by zero
  // and makes hedging worthless, so expected value rises with confidence and always
  // answering 100% becomes optimal again. That was the original Prediction League defect.
  // Scaling the full share instead restores the proper scoring rule, where reporting your
  // true belief maximises expected points.
  let delta = 0;
  let points = 0;
  if (shape === "series") {
    const perCall = sharePoints(maxPoints, attempt, allowed, true);
    const fallback = correct ? 1 : 0;
    const weight = Number.isFinite(verdict.weight)
      ? Math.min(1, Math.max(0, verdict.weight))
      : fallback;
    delta = Math.round(perCall * weight);
    points = (existing?.points ?? 0) + delta;
  } else if (correct) {
    delta = attemptPoints(maxPoints, attemptsUsed, allowed);
    points = delta;
  }

  const entry = {
    gameId,
    periodKey,
    guesses,
    attemptsUsed,
    solved: correct || existing?.solved === true,
    finished,
    points,
  };

  const progress = { ...current.progress, [key]: entry };
  const history = finished
    ? [
        entry,
        ...current.history.filter(
          (row) => keyFor(row.gameId, row.periodKey) !== key,
        ),
      ].slice(0, HISTORY_LIMIT)
    : current.history;

  return {
    accepted: true,
    reason: null,
    correct,
    duplicate: false,
    finished,
    points: delta,
    attemptsUsed,
    attemptsLeft: Math.max(0, allowed - attemptsUsed),
    feedback: { ...guess },
    reveal: isPlainObject(verdict.reveal) ? verdict.reveal : null,
    state: {
      progress,
      history,
      points: history.reduce((sum, row) => sum + row.points, 0),
    },
  };
}

export function pointsFor(ledger, gameId) {
  return createLedger(ledger).history.reduce(
    (sum, entry) => (entry.gameId === gameId ? sum + entry.points : sum),
    0,
  );
}

// Finished periods only: an abandoned run does not extend a streak.
export function finishedPeriods(ledger) {
  return createLedger(ledger).history.map((entry) => entry.periodKey);
}

export { HISTORY_LIMIT, keyFor };
