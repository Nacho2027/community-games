import { describe, expect, it } from "vitest";
import * as challenge from "../src/games/challenge.js";
import { registry } from "../src/games/index.js";
import { createApi } from "../src/server/api.js";

const AT = new Date("2026-03-04T12:00:00Z");
const DAY = "2026-03-04";

function harness({ authenticated = true, storage = new Map() } = {}) {
  const api = createApi({
    identify: async () => {
      if (!authenticated) throw new Error("no session");
      return { id: "u1", name: "ada" };
    },
    loadLedger: async (player) => storage.get(player.name) ?? undefined,
    saveLedger: async (player, ledger) => storage.set(player.name, ledger),
    now: () => AT,
  });
  return { api, storage };
}

function solution() {
  const solved = challenge.solve(challenge.roundFor(DAY));
  if (!solved) throw new Error("the fixed day is unsolvable");
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

// Well-formed but deliberately wrong: spends an attempt without solving.
function wrongMove() {
  const round = challenge.roundFor(DAY);
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

// Answer-bearing keys no public round may expose. Substring scans over serialized rounds
// false-positive on legitimate prose (Prediction asks about "today's solution"), so this
// walks keys instead.
const FORBIDDEN_KEYS = new Set([
  "answer",
  "correct",
  "culprit",
  "culpritId",
  "excludes",
  "numbers",
  "ops",
  "outcome",
  "solution",
  "strength",
  "totals",
  "votes",
  "winner",
  "winnerId",
]);

function keysOf(value, into = new Set()) {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysOf(child, into);
    }
  return into;
}

describe("server api", () => {
  it("requires a factory contract", () => {
    expect(() => createApi({})).toThrow();
    expect(() => createApi({ identify: () => ({ name: "x" }) })).toThrow();
    expect(() =>
      createApi({ identify: () => null, loadLedger: () => null }),
    ).toThrow();
  });

  it("rejects unauthenticated callers", async () => {
    const { api } = harness({ authenticated: false });
    expect((await api.state()).status).toBe(401);
    expect((await api.play({ gameId: "challenge", action: {} })).status).toBe(
      401,
    );
    expect((await api.round({ gameId: "challenge" })).status).toBe(401);
  });

  it("rejects a caller that identifies without a name", async () => {
    const api = createApi({
      identify: async () => ({ id: "u9" }),
      loadLedger: async () => undefined,
      saveLedger: async () => {},
      now: () => AT,
    });
    expect((await api.state()).status).toBe(401);
  });

  it("returns the player and their progress", async () => {
    const result = await harness().api.state();
    expect(result.status).toBe(200);
    expect(result.body.player.name).toBe("ada");
    expect(result.body.ledger.points).toBe(0);
    expect(result.body.ledger.progress).toEqual({});
  });

  it("serves every registered game's round with its attempt position", async () => {
    const { api } = harness();
    for (const game of registry) {
      const result = await api.round({ gameId: game.meta.id });
      expect(result.status, game.meta.id).toBe(200);
      expect(result.body.periodKey).toBe(DAY);
      expect(result.body.round).toBeTruthy();
      expect(result.body.attempt).toBe(1);
      expect(result.body.attemptsUsed).toBe(0);
      expect(result.body.maxAttempts).toBe(game.meta.maxAttempts);
      expect(result.body.finished).toBe(false);
      expect(result.body.solved).toBe(false);
    }
  });

  it("404s an unknown game and lists the valid ids", async () => {
    const result = await harness().api.round({ gameId: "nope" });
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("unknown-game");
    expect(result.body.games).toHaveLength(5);
    expect(result.body.games).toContain("challenge");
  });

  it("awards the ceiling for a first-attempt solve and persists it", async () => {
    const { api, storage } = harness();
    const result = await api.play({ gameId: "challenge", action: solution() });

    expect(result.status).toBe(200);
    expect(result.body.accepted).toBe(true);
    expect(result.body.correct).toBe(true);
    expect(result.body.points).toBe(challenge.meta.maxPoints);
    expect(result.body.finished).toBe(true);
    expect(result.body.attemptsUsed).toBe(1);
    expect(result.body.attemptsLeft).toBe(challenge.meta.maxAttempts - 1);
    expect(result.body.feedback.state).toBe("correct");

    expect(storage.get("ada").points).toBe(challenge.meta.maxPoints);
    expect(storage.get("ada").history).toHaveLength(1);
  });

  it("refuses a duplicate attempt without awarding points again", async () => {
    const { api, storage } = harness();
    await api.play({ gameId: "challenge", action: solution() });

    const again = await api.play({ gameId: "challenge", action: solution() });
    expect(again.body.accepted).toBe(false);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.points).toBe(0);

    expect(storage.get("ada").points).toBe(challenge.meta.maxPoints);
    expect(storage.get("ada").history).toHaveLength(1);
  });

  it("does not consume an attempt for a malformed action", async () => {
    const { api } = harness();
    const bad = await api.play({ gameId: "challenge", action: { nope: 1 } });
    expect(bad.body.accepted).toBe(false);
    expect(bad.body.reason).toBeTruthy();

    const good = await api.play({ gameId: "challenge", action: solution() });
    expect(good.body.accepted).toBe(true);
    expect(good.body.points).toBe(challenge.meta.maxPoints);
  });

  it("spends an attempt on a wrong answer and pays less for a later solve", async () => {
    const { api } = harness();

    const miss = await api.play({ gameId: "challenge", action: wrongMove() });
    expect(miss.body.accepted).toBe(true);
    expect(miss.body.correct).toBe(false);
    expect(miss.body.points).toBe(0);
    expect(miss.body.finished).toBe(false);
    expect(miss.body.attemptsUsed).toBe(1);
    expect(miss.body.attemptsLeft).toBe(challenge.meta.maxAttempts - 1);
    expect(miss.body.feedback.label).toMatch(/=/);

    // The round tells the client where it is, so the board can advance.
    const round = await api.round({ gameId: "challenge" });
    expect(round.body.attempt).toBe(2);
    expect(round.body.attemptsUsed).toBe(1);
    expect(round.body.finished).toBe(false);

    const solved = await api.play({ gameId: "challenge", action: solution() });
    expect(solved.body.points).toBeGreaterThan(0);
    expect(solved.body.points).toBeLessThan(challenge.meta.maxPoints);
    expect(solved.body.finished).toBe(true);
    expect(solved.body.attemptsUsed).toBe(2);
  });

  it("closes the round once the period is finished", async () => {
    const { api } = harness();
    await api.play({ gameId: "challenge", action: solution() });

    const round = await api.round({ gameId: "challenge" });
    expect(round.status).toBe(200);
    expect(round.body.round).toBeNull();
    expect(round.body.finished).toBe(true);
    expect(round.body.solved).toBe(true);
  });

  it("gets no closer to the answer when it refuses a move", async () => {
    const { api } = harness();
    const before = await api.round({ gameId: "challenge" });
    const after = await api.round({ gameId: "challenge" });
    expect(after.body.round).toEqual(before.body.round);
  });

  it("never leaks an answer-bearing key through any round endpoint", async () => {
    const { api } = harness();
    for (const game of registry) {
      const result = await api.round({ gameId: game.meta.id });
      const keys = keysOf(result.body.round);
      for (const key of keys)
        expect(FORBIDDEN_KEYS.has(key), `${game.meta.id} leaks ${key}`).toBe(
          false,
        );
    }
  });

  it("keeps separate progress per player", async () => {
    const storage = new Map();
    await harness({ storage }).api.play({
      gameId: "challenge",
      action: solution(),
    });

    const second = createApi({
      identify: async () => ({ id: "u2", name: "grace" }),
      loadLedger: async (player) => storage.get(player.name) ?? undefined,
      saveLedger: async (player, ledger) => storage.set(player.name, ledger),
      now: () => AT,
    });
    const state = await second.state();
    expect(state.body.player.name).toBe("grace");
    expect(state.body.ledger.points).toBe(0);
  });
});
