// Authoritative action ledger shared by the web UI and every platform adapter.
// Pure: every export returns new objects and never mutates its inputs.

const HISTORY_LIMIT = 200;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function sanitizeEntry(entry) {
  if (!isPlainObject(entry)) return null;
  if (typeof entry.gameId !== "string" || !entry.gameId) return null;
  if (typeof entry.periodKey !== "string" || !entry.periodKey) return null;
  return {
    gameId: entry.gameId,
    periodKey: entry.periodKey,
    points: toInt(entry.points),
    at: typeof entry.at === "string" ? entry.at : new Date(0).toISOString(),
  };
}

export function createLedger(initial = {}) {
  const source = isPlainObject(initial) ? initial : {};
  const actions = {};
  if (isPlainObject(source.actions)) {
    for (const [key, entry] of Object.entries(source.actions)) {
      const safe = sanitizeEntry(entry);
      if (safe && key === `${safe.gameId}:${safe.periodKey}`)
        actions[key] = safe;
    }
  }
  const history = (Array.isArray(source.history) ? source.history : [])
    .map(sanitizeEntry)
    .filter(Boolean)
    .slice(0, HISTORY_LIMIT);
  const points = Number.isFinite(Number(source.points))
    ? toInt(source.points)
    : history.reduce((sum, entry) => sum + entry.points, 0);
  return { actions, points, history };
}

function keyFor(gameId, periodKey) {
  return `${gameId}:${periodKey}`;
}

function hasSlot(ledger, gameId, periodKey) {
  return Object.hasOwn(ledger.actions, keyFor(gameId, periodKey));
}

function rejected(state, reason) {
  return {
    accepted: false,
    reason,
    duplicate: false,
    points: 0,
    result: null,
    reveal: null,
    state,
  };
}

export function applyAction(ledger, request = {}) {
  const current = createLedger(ledger);
  const { gameId, periodKey, round, action, submit, now } = isPlainObject(
    request,
  )
    ? request
    : {};
  const at = typeof now === "string" ? now : new Date().toISOString();

  if (typeof gameId !== "string" || !gameId)
    return rejected(current, "invalid-game-id");
  if (typeof periodKey !== "string" || !periodKey)
    return rejected(current, "invalid-period-key");
  if (typeof submit !== "function") return rejected(current, "missing-submit");

  if (hasSlot(current, gameId, periodKey)) {
    return {
      accepted: false,
      reason: "already-played",
      duplicate: true,
      points: 0,
      result: null,
      reveal: null,
      state: current,
    };
  }

  let reveal;
  try {
    reveal = submit(round, action);
  } catch {
    return rejected(current, "submit-failed");
  }

  if (!isPlainObject(reveal) || reveal.accepted !== true) {
    const reason =
      isPlainObject(reveal) && typeof reveal.reason === "string"
        ? reveal.reason
        : "rejected";
    return {
      accepted: false,
      reason,
      duplicate: false,
      points: 0,
      result: isPlainObject(reveal) ? (reveal.result ?? null) : null,
      reveal: isPlainObject(reveal) ? (reveal.reveal ?? null) : null,
      state: current,
    };
  }

  const points = Math.max(0, toInt(reveal.points));
  const entry = { gameId, periodKey, points, at };
  const state = {
    actions: { ...current.actions, [keyFor(gameId, periodKey)]: entry },
    points: current.points + points,
    history: [entry, ...current.history].slice(0, HISTORY_LIMIT),
  };

  return {
    accepted: true,
    reason: null,
    duplicate: false,
    points,
    result: reveal.result ?? null,
    reveal: reveal.reveal ?? null,
    state,
  };
}

export function canPlay(ledger, gameId, periodKey) {
  const current = createLedger(ledger);
  if (typeof gameId !== "string" || typeof periodKey !== "string") return false;
  return !hasSlot(current, gameId, periodKey);
}

export function pointsFor(ledger, gameId) {
  const current = createLedger(ledger);
  return current.history.reduce(
    (sum, entry) => (entry.gameId === gameId ? sum + entry.points : sum),
    0,
  );
}

export { HISTORY_LIMIT };
