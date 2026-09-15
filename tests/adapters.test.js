import { describe, expect, it } from "vitest";
import {
  createHttpAdapter,
  createLocalAdapter,
  detectAdapter,
} from "../src/adapters/index.js";
import * as challenge from "../src/games/challenge.js";
import { ADAPTER_STORAGE_KEY } from "../src/adapters/index.js";

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    size: () => data.size,
  };
}

// A real action for the fixed period the adapter will use.
function solutionFor(periodKey) {
  return challenge.solve(challenge.roundFor(periodKey));
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
    const state = await adapter.load();
    expect(state.ledger.points).toBe(0);

    const outcome = await adapter.submit(
      "challenge",
      solutionFor("2026-03-04"),
    );
    expect(["accepted", "duplicate"]).toContain(
      outcome.duplicate ? "duplicate" : "accepted",
    );

    const reloaded = await createLocalAdapter({ storage }).load();
    expect(typeof reloaded.ledger.points).toBe("number");
  });

  it("never awards points twice for the same period", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAdapter({ storage });
    await adapter.load();

    const action = solutionFor(currentDay());
    const first = await adapter.submit("challenge", action);
    expect(first.accepted).toBe(true);
    expect(first.points).toBe(10);

    const second = await adapter.submit("challenge", action);
    expect(second.accepted).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.points).toBe(0);

    const state = await adapter.load();
    expect(state.ledger.points).toBe(10);
    expect(state.ledger.history).toHaveLength(1);
  });

  it("rejects invalid actions without consuming the period", async () => {
    const storage = memoryStorage();
    const adapter = createLocalAdapter({ storage });
    await adapter.load();

    const bad = await adapter.submit("challenge", { nonsense: true });
    expect(bad.accepted).toBe(false);

    const good = await adapter.submit("challenge", solutionFor(currentDay()));
    expect(good.accepted).toBe(true);
    expect(good.points).toBe(10);
  });

  it("sanitizes state written by a hostile client", async () => {
    const storage = memoryStorage({
      [ADAPTER_STORAGE_KEY]: JSON.stringify({
        ledger: { points: 99999, history: "nope" },
      }),
    });
    const state = await createLocalAdapter({ storage }).load();
    expect(state.ledger.points).toBe(0);
    expect(Array.isArray(state.ledger.history)).toBe(true);
  });
});

describe("http adapter", () => {
  it("forwards raw actions and trusts the server response", async () => {
    const history = [
      {
        gameId: "prediction",
        periodKey: "2026-03-03",
        points: 25,
        at: "2026-03-03T00:00:00.000Z",
      },
    ];
    const fetchImpl = fakeFetch({
      "/state": () => ({
        player: { id: "u1", name: "Ada" },
        ledger: { points: 25, actions: {}, history },
      }),
      "/play": () => ({
        accepted: true,
        points: 10,
        result: { computed: 58 },
        reveal: { solved: true },
        state: {
          actions: {},
          history: [
            {
              gameId: "challenge",
              periodKey: "2026-03-04",
              points: 10,
              at: "2026-03-04T00:00:00.000Z",
            },
            ...history,
          ],
        },
      }),
    });
    const adapter = createHttpAdapter({
      endpoint: "https://example.test/api",
      fetchImpl,
    });
    await adapter.load();

    const outcome = await adapter.submit("challenge", {
      numbers: [1, 2, 3],
      ops: ["+", "+"],
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.points).toBe(10);
    expect(outcome.state.points).toBe(35);
    expect(fetchImpl.calls.at(-1)).toMatchObject({
      path: "/play",
      method: "POST",
    });

    // The client recomputes points from authoritative history, never from a raw number.
    const state = await adapter.load();
    expect(state.ledger.points).toBe(25);
  });

  it("treats server rejection as a rejection", async () => {
    const fetchImpl = fakeFetch({
      "/state": () => ({ ledger: { points: 0, actions: {}, history: [] } }),
      "/play": () => ({
        accepted: false,
        reason: "already-played",
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
    expect(outcome.reason).toContain("network");
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

function currentDay() {
  return new Date().toISOString().slice(0, 10);
}
