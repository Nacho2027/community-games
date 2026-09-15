import { createLedger } from "./engine/progress.js";

// Bumped to v3: the ledger used to be an `actions` map keyed by game and period. It is now
// a `progress` map of attempt entries, so v2 data is not readable and must not be trusted.
const STORAGE_KEY = "community-games-lab:v3";

const DEFAULT_PLAYER = { id: "local-player", name: "Player" };

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

// createLedger already validates every entry, coerces hostile values, caps history, and
// recomputes points from scratch, so stored data is never trusted as-is.
export function createState(initial = {}) {
  const source = isPlainObject(initial) ? initial : {};
  const player = isPlainObject(source.player) ? source.player : {};
  return {
    player: {
      id: text(player.id, DEFAULT_PLAYER.id),
      name: text(player.name, DEFAULT_PLAYER.name),
    },
    ledger: createLedger(source.ledger),
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