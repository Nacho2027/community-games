import { describe, expect, it } from "vitest";
import {
  createHttpAdapter,
  createLocalAdapter,
  detectAdapter,
} from "../src/adapters/index.js";
import { keyFor } from "../src/engine/progress.js";
import * as challenge from "../src/games/challenge.js";
import { STORAGE_KEY } from "../src/state.js";

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

// The local adapter plays against the live period, so actions must target today.
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function todaysSolution() {
  const round = challenge.roundFor(todayKey());
  const solved = challenge.solve(round);
  if (!solved) throw new Error("today's puzzle is unsolvable");
  return solved;
}

function evaluate(numbers, ops) {
  let total = numbers[0];
  for (let index = 0; index < ops.length; index += 1) {
    const operand = numbers[index + 1];
    if (ops[index] === "+") total += operand;
    else if (ops[index] === "-") total -= operand;
    else total *= operand;
  }
  return total;
}

const OP_SETS = [
  ["+", "+"],
  ["-", "-"],
  ["*", "*"],
  ["+", "-"],
  ["-", "+"],
  ["*", "+"],
  ["+", "*"],
  ["-", "*"],
  ["*", "-"],
];

// A well-formed expression built from the pool that deliberately misses the target, so it
// consumes an attempt without solving. Used to prove a wrong move costs an attempt while a
// malformed one does not.
function wrongMove(round) {
  const pool = round.pool;
  for (let i = 0; i < pool.length; i += 1)
    for (let j = 0; j < pool.length; j += 1) {
      if (j === i) continue;
      for (let k = 0; k < pool.length; k += 1) {
        if (k === i || k === j) continue;
        const numbers = [pool[i], pool[j], pool[k]];
        for (const ops of OP_SETS)
          if (evaluate(numbers, ops) !== round.target) return { numbers, ops };
      }
    }
  throw new Error("no well-formed miss exists");
}

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const path = url.replace(/^.*?\/api/, "");
    calls.push({ path, method: options.method ?? "GET", body: options.body });
    const handler = routes[path];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    const payload = await handler(
      options.body ? JSON.parse(options.body) : undefined,
    );
    return { ok: true, status: 200, json: async () => payload };
  };
  impl.calls = calls;
  return impl;
}

describe("local adapter", () => {
  it("plays through the shared rules and persists the result", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAdapter({ storage });
    expect((await adapter.load()).ledger.points).toBe(0);

    const outcome = await adapter.submit("challenge", todaysSolution());
    expect(outcome.accepted).toBe(true);
    expect(outcome.correct).toBe(true);
    expect(outcome.points).toBe(challenge.meta.maxPoints);
    expect(outcome.finished).toBe(true);

    const reloaded = await createLocalAdapter({ storage }).load();
    expect(reloaded.ledger.points).toBe(challenge.meta.maxPoints);
    expect(reloaded.ledger.history).toHaveLength(1);
    expect(
      reloaded.ledger.progress[keyFor("challenge", todayKey())].finished,
    ).toBe(true);
  });

  it("never awards points twice for the same period", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAdapter({ storage });
    await adapter.load();

    const action = todaysSolution();
    const first = await adapter.submit("challenge", action);
    expect(first.accepted).toBe(true);
    expect(first.points).toBe(challenge.meta.maxPoints);

    const second = await adapter.submit("challenge", action);
    expect(second.accepted).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.points).toBe(0);

    const state = await adapter.load();
    expect(state.ledger.points).toBe(challenge.meta.maxPoints);
    expect(state.ledger.history).toHaveLength(1);
  });

  it("rejects a malformed action without consuming an attempt", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAdapter({ storage });
    await adapter.load();

    const bad = await adapter.submit("challenge", { nonsense: true });
    expect(bad.accepted).toBe(false);
    expect(bad.feedback).toBeNull();

    // Still the first attempt, so it still pays the full ceiling.
    const good = await adapter.submit("challenge", todaysSolution());
    expect(good.accepted).toBe(true);
    expect(good.points).toBe(challenge.meta.maxPoints);
  });

  it("spends an attempt on a well-formed but wrong answer", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAdapter({ storage });
    await adapter.load();

    const round = challenge.roundFor(todayKey());
    const miss = await adapter.submit("challenge", wrongMove(round));
    expect(miss.accepted).toBe(true);
    expect(miss.correct).toBe(false);
    expect(miss.points).toBe(0);
    expect(miss.attemptsUsed).toBe(1);
    expect(miss.attemptsLeft).toBe(challenge.meta.maxAttempts - 1);
    expect(miss.finished).toBe(false);
    expect(miss.feedback.detail).toMatch(/too (low|high)/);

    // Solving second pays less than solving first.
    const solved = await adapter.submit("challenge", todaysSolution());
    expect(solved.points).toBeLessThan(challenge.meta.maxPoints);
    expect(solved.points).toBeGreaterThan(0);
  });

  it("sanitizes state written by a hostile client", async () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        ledger: { points: 99999, history: "nope", progress: "also-nope" },
      }),
    });
    const state = await createLocalAdapter({ storage }).load();
    expect(state.ledger.points).toBe(0);
    expect(Array.isArray(state.ledger.history)).toBe(true);
    expect(state.ledger.progress).toEqual({});
  });
});

describe("http adapter", () => {
  const existing = [
    {
      gameId: "prediction",
      periodKey: "2026-03-03",
      points: 25,
      at: "2026-03-03T00:00:00.000Z",
    },
  ];
  const fresh = {
    gameId: "challenge",
    periodKey: "2026-03-04",
    points: 10,
    guesses: [
      {
        label: "6 * 6 - 6 = 30",
        state: "correct",
        at: "2026-03-04T00:00:00.000Z",
      },
    ],
  };

  it("forwards the raw action and trusts the server's ledger", async () => {
    const fetchImpl = fakeFetch({
      "/state": () => ({
        player: { id: "u1", name: "Ada" },
        ledger: { points: 25, progress: {}, history: existing },
      }),
      "/play": () => ({
        accepted: true,
        correct: true,
        points: 10,
        feedback: {
          label: "6 * 6 - 6 = 30",
          state: "correct",
          detail: "Exactly on target.",
        },
        reveal: { computed: 30, target: 30, delta: 0 },
        finished: true,
        attemptsUsed: 1,
        attemptsLeft: 5,
        // A tampered total must be ignored: points are recomputed from history.
        state: { points: 99999, progress: {}, history: [fresh, ...existing] },
      }),
    });

    const adapter = createHttpAdapter({
      endpoint: "https://example.test/api",
      fetchImpl,
    });
    await adapter.load();

    const raw = { numbers: [1, 2, 3], ops: ["+", "+"] };
    const outcome = await adapter.submit("challenge", raw);

    expect(outcome.accepted).toBe(true);
    expect(outcome.correct).toBe(true);
    expect(outcome.finished).toBe(true);
    expect(outcome.points).toBe(10);
    expect(outcome.attemptsUsed).toBe(1);
    expect(outcome.attemptsLeft).toBe(5);
    expect(outcome.feedback.label).toBe("6 * 6 - 6 = 30");
    expect(outcome.state.points).toBe(35);
    expect(fetchImpl.calls.at(-1)).toMatchObject({
      path: "/play",
      method: "POST",
    });
    // The client forwards the action untouched and lets the server judge it.
    expect(JSON.parse(fetchImpl.calls.at(-1).body)).toEqual({
      gameId: "challenge",
      action: raw,
    });

    const state = await adapter.load();
    expect(state.ledger.points).toBe(25);
  });

  it("treats server rejection as a rejection", async () => {
    const fetchImpl = fakeFetch({
      "/state": () => ({ ledger: { points: 0, progress: {}, history: [] } }),
      "/play": () => ({
        accepted: false,
        reason: "already-finished",
        duplicate: true,
        points: 0,
      }),
    });
    const adapter = createHttpAdapter({
      endpoint: "https://example.test/api",
      fetchImpl,
    });
    const outcome = await adapter.submit("challenge", {});
    expect(outcome.accepted).toBe(false);
    expect(outcome.duplicate).toBe(true);
    expect(outcome.points).toBe(0);
    expect(outcome.correct).toBe(false);
    expect(outcome.finished).toBe(false);
  });

  it("survives a network failure without awarding points", async () => {
    const adapter = createHttpAdapter({
      endpoint: "https://example.test/api",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    const outcome = await adapter.submit("challenge", {});
    expect(outcome.accepted).toBe(false);
    expect(outcome.points).toBe(0);
    expect(outcome.feedback).toBeNull();
    expect(outcome.reason).toContain("network");
  });

  it("survives a failing state load without crashing", async () => {
    const adapter = createHttpAdapter({
      endpoint: "https://example.test/api",
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      }),
    });
    const state = await adapter.load();
    expect(state.ledger.points).toBe(0);
  });

  it("requires an endpoint", () => {
    expect(() => createHttpAdapter({})).toThrow();
  });
});

describe("adapter detection", () => {
  it("uses the local adapter when no API is configured", () => {
    expect(detectAdapter({ endpoint: undefined }).kind).toBe("local");
  });

  it("uses the http adapter when an API is injected", () => {
    expect(detectAdapter({ endpoint: "https://example.test/api" }).kind).toBe(
      "http",
    );
  });
});
