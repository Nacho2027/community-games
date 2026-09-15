import { createLedger } from "./engine/actions.js";

const STORAGE_KEY = "community-games-lab:v2";

const DEFAULT_STATE = {
  player: { id: "local-player", name: "Player" },
  ledger: createLedger(),
};

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function sanitizeEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const gameId = typeof entry.gameId === "string" ? entry.gameId : null;
  const periodKey =
    typeof entry.periodKey === "string" ? entry.periodKey : null;
  if (!gameId || !periodKey) return null;
  return {
    gameId,
    periodKey,
    points: finiteInt(entry.points),
    at: typeof entry.at === "string" ? entry.at : new Date(0).toISOString(),
  };
}

function sanitizeLedger(value) {
  const source = isPlainObject(value) ? value : {};
  const ledger = createLedger();
  const actions = isPlainObject(source.actions) ? source.actions : {};
  for (const [key, entry] of Object.entries(actions)) {
    const safe = sanitizeEntry(entry);
    if (safe) ledger.actions[key] = safe;
  }
  ledger.history = (Array.isArray(source.history) ? source.history : [])
    .map(sanitizeEntry)
    .filter(Boolean)
    .slice(0, 200);
  ledger.points = ledger.history.reduce((sum, entry) => sum + entry.points, 0);
  return ledger;
}

export function createState(initial = {}) {
  const source = isPlainObject(initial) ? initial : {};
  const player = isPlainObject(source.player) ? source.player : {};
  return {
    player: {
      id:
        typeof player.id === "string" && player.id
          ? player.id
          : DEFAULT_STATE.player.id,
      name:
        typeof player.name === "string" && player.name
          ? player.name
          : DEFAULT_STATE.player.name,
    },
    ledger: sanitizeLedger(source.ledger),
  };
}

export function loadState(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== "function") return createState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? createState(JSON.parse(raw)) : createState();
  } catch {
    return createState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(createState(state)));
    return true;
  } catch {
    // Quota or security errors must never break gameplay.
    return false;
  }
}

export { STORAGE_KEY };
