import { describe, expect, it } from "vitest";
import { createLedger, keyFor } from "../src/engine/progress.js";
import {
  createState,
  loadState,
  saveState,
  STORAGE_KEY,
} from "../src/state.js";

function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    raw: () => data.get(STORAGE_KEY),
  };
}

function guess(label = "6 * 6 - 6 = 30") {
  return {
    label,
    state: "correct",
    detail: "Exactly on target.",
    at: "2026-03-04T00:00:00.000Z",
  };
}

function entry(gameId, periodKey, points) {
  return {
    gameId,
    periodKey,
    guesses: [guess()],
    solved: true,
    finished: true,
    points,
  };
}

describe("state", () => {
  it("starts empty", () => {
    const state = createState();
    expect(state.player.id).toBeTruthy();
    expect(state.ledger.points).toBe(0);
    expect(state.ledger.history).toEqual([]);
    expect(state.ledger.progress).toEqual({});
  });

  it("round trips through storage", () => {
    const store = storage();
    const state = createState({
      player: { id: "p1", name: "Ada" },
      ledger: createLedger({
        progress: {
          [keyFor("challenge", "2026-03-04")]: entry(
            "challenge",
            "2026-03-04",
            100,
          ),
        },
        history: [entry("challenge", "2026-03-04", 100)],
      }),
    });

    saveState(state, store);
    expect(loadState(store)).toEqual(state);
    expect(store.raw()).toContain("challenge");
  });

  it("recovers from malformed JSON", () => {
    expect(loadState(storage({ [STORAGE_KEY]: "not-json" }))).toEqual(
      createState(),
    );
  });

  it("coerces tampered values into a safe shape", () => {
    const tampered = JSON.stringify({
      player: { id: 42, name: null },
      ledger: {
        // A stored total is never trusted: points are recomputed from history below.
        points: 99999,
        progress: {
          [keyFor("challenge", "2026-03-04")]: {
            gameId: "challenge",
            periodKey: "2026-03-04",
            points: "9999",
            guesses: "nope",
            solved: "yes",
            finished: 1,
          },
          // Key does not match gameId:periodKey, so it cannot be trusted as that period.
          "mismatched-key": {
            gameId: "challenge",
            periodKey: "2026-03-04",
            points: 50,
          },
          bad: { gameId: 1 },
        },
        history: [
          {
            gameId: "challenge",
            periodKey: "2026-03-04",
            points: "5",
            guesses: null,
          },
          null,
          "nope",
          42,
        ],
      },
    });

    const state = loadState(storage({ [STORAGE_KEY]: tampered }));

    expect(state.player.id).toBe("local-player");
    expect(state.player.name).toBe("Player");
    expect(state.ledger.points).toBe(5);
    expect(state.ledger.history).toHaveLength(1);

    const safe = state.ledger.progress[keyFor("challenge", "2026-03-04")];
    expect(safe.points).toBe(9999);
    expect(safe.guesses).toEqual([]);
    expect(safe.attemptsUsed).toBe(0);
    expect(safe.solved).toBe(false);
    expect(safe.finished).toBe(false);

    expect(state.ledger.progress["mismatched-key"]).toBeUndefined();
    expect(state.ledger.progress.bad).toBeUndefined();
  });

  it("ignores a stored points number and recomputes it from history", () => {
    const store = storage({
      [STORAGE_KEY]: JSON.stringify({
        ledger: {
          points: 99999,
          history: [
            { gameId: "challenge", periodKey: "2026-03-04", points: 40 },
            { gameId: "mystery", periodKey: "2026-03-04", points: 60 },
          ],
        },
      }),
    });
    expect(loadState(store).ledger.points).toBe(100);
  });

  it("caps restored history at 200 entries", () => {
    const history = Array.from({ length: 500 }, (_, index) => ({
      gameId: "challenge",
      periodKey: `2026-01-${index}`,
      points: 1,
    }));
    const state = loadState(
      storage({ [STORAGE_KEY]: JSON.stringify({ ledger: { history } }) }),
    );
    expect(state.ledger.history).toHaveLength(200);
    expect(state.ledger.points).toBe(200);
  });

  it("survives storage that throws", () => {
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
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
    expect(state.ledger.progress).toEqual({});
    expect(state.ledger.history).toEqual([]);
    expect(state.ledger.points).toBe(0);
  });

  it("does not share ledger objects between two created states", () => {
    const first = createState();
    first.ledger.history.push(entry("challenge", "2026-03-04", 10));
    expect(createState().ledger.history).toEqual([]);
  });
});
