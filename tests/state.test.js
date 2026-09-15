import { describe, expect, it } from "vitest";
import { createState, loadState, saveState, STORAGE_KEY } from "../src/state.js";
import { createLedger } from "../src/engine/actions.js";

function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe("state", () => {
  it("starts empty", () => {
    const state = createState();
    expect(state.player.id).toBeTruthy();
    expect(state.ledger.points).toBe(0);
    expect(state.ledger.history).toEqual([]);
  });

  it("round trips through storage", () => {
    const store = storage();
    const state = createState({
      player: { id: "p1", name: "Ada" },
      ledger: {
        actions: { "challenge:2026-01-01": { gameId: "challenge", periodKey: "2026-01-01", points: 10, at: "2026-01-01T00:00:00.000Z" } },
        history: [{ gameId: "challenge", periodKey: "2026-01-01", points: 10, at: "2026-01-01T00:00:00.000Z" }],
      },
    });
    saveState(state, store);
    expect(loadState(store)).toEqual(state);
    expect(store.getItem(STORAGE_KEY)).toContain("challenge");
  });

  it("recovers from malformed JSON", () => {
    expect(loadState(storage({ [STORAGE_KEY]: "not-json" }))).toEqual(createState());
  });

  it("coerces tampered values into a safe shape", () => {
    const tampered = JSON.stringify({
      player: { id: 42, name: null },
      ledger: {
        actions: { bad: { gameId: 1 }, "challenge:2026-01-01": { gameId: "challenge", periodKey: "2026-01-01", points: "9999", at: null } },
        history: [{ gameId: "challenge", periodKey: "2026-01-01", points: "5" }, null, "nope"],
        points: "abc",
      },
    });
    const state = loadState(storage({ [STORAGE_KEY]: tampered }));
    expect(state.player.id).toBe("local-player");
    expect(state.ledger.actions.bad).toBeUndefined();
    expect(state.ledger.actions["challenge:2026-01-01"].points).toBe(9999);
    expect(state.ledger.history).toHaveLength(1);
    // Points are always recomputed from history, never trusted from storage.
    expect(state.ledger.points).toBe(5);
  });

  it("caps restored history at 200 entries", () => {
    const history = Array.from({ length: 500 }, (_, index) => ({
      gameId: "challenge",
      periodKey: `2026-01-${index}`,
      points: 1,
      at: "2026-01-01T00:00:00.000Z",
    }));
    const state = loadState(storage({ [STORAGE_KEY]: JSON.stringify({ ledger: { history } }) }));
    expect(state.ledger.history).toHaveLength(200);
    expect(state.ledger.points).toBe(200);
  });

  it("survives storage that throws", () => {
    const hostile = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
    };
    expect(loadState(hostile)).toEqual(createState());
    expect(saveState(createState(), hostile)).toBe(false);
  });

  it("tolerates missing storage entirely", () => {
    expect(loadState(undefined)).toEqual(createState());
    expect(saveState(createState(), undefined)).toBe(false);
  });

  it("keeps a valid ledger intact", () => {
    const state = createState({ ledger: createLedger() });
    expect(state.ledger.actions).toEqual({});
    expect(state.ledger.history).toEqual([]);
  });
});