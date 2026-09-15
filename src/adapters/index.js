import { createState, loadState, saveState } from "../state.js";
import { play } from "../games/index.js";

// Adapter seam. The UI only ever calls load/save/submit; it never computes a score.
//
//   load()                -> Promise<state>
//   save(state)           -> Promise<boolean>
//   submit(gameId, action) -> Promise<outcome>
//
// Local play still routes through the shared play() entry point, so the browser and the
// hosted platforms run identical rules. Remote adapters forward the raw action and let the
// server decide.

export function createLocalAdapter({ storage = globalThis.localStorage } = {}) {
  let state = loadState(storage);

  return {
    kind: "local",
    async load() {
      state = loadState(storage);
      return state;
    },
    async save(next) {
      state = createState(next);
      return saveState(state, storage);
    },
    async submit(gameId, action) {
      const outcome = play(state.ledger, gameId, action);
      if (outcome.accepted) {
        state = createState({ ...state, ledger: outcome.state });
        saveState(state, storage);
      }
      return outcome;
    },
  };
}

export function createHttpAdapter({
  endpoint,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!endpoint) throw new Error("createHttpAdapter requires an endpoint");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  let state = createState();

  async function request(path, body) {
    const response = await fetchImpl(`${endpoint}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`request failed: ${response.status}`);
    return response.json();
  }

  return {
    kind: "http",
    async load() {
      try {
        state = createState(await request("/state"));
      } catch {
        // Offline or unauthenticated: keep the last known state rather than crashing.
      }
      return state;
    },
    async save(next) {
      state = createState(next);
      return true; // The server is the source of truth; nothing to push.
    },
    async submit(gameId, action) {
      try {
        const outcome = await request("/play", { gameId, action });
        // Trust the server's ledger over anything the client already had.
        // The server returns a ledger, not a full state, so merge it in.
        if (outcome?.state)
          state = createState({ ...state, ledger: outcome.state });
        return {
          accepted: Boolean(outcome?.accepted),
          reason: outcome?.reason ?? null,
          duplicate: Boolean(outcome?.duplicate),
          points: Number(outcome?.points) || 0,
          result: outcome?.result ?? null,
          reveal: outcome?.reveal ?? null,
          state: state.ledger,
        };
      } catch (error) {
        return {
          accepted: false,
          reason: `network:${error.message}`,
          duplicate: false,
          points: 0,
          result: null,
          reveal: null,
          state: state.ledger,
        };
      }
    },
  };
}

// Choose an adapter for the current environment. Hosted platforms inject an API base.
export function detectAdapter({ endpoint = globalThis.__GAMES_API__ } = {}) {
  return endpoint ? createHttpAdapter({ endpoint }) : createLocalAdapter();
}
