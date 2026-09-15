import { describe, expect, it } from "vitest";
import * as challenge from "../src/games/challenge.js";
import * as mystery from "../src/games/mystery.js";
import { createLedger, pointsFor } from "../src/engine/actions.js";
import { gameById, gameIds, play, registry } from "../src/games/index.js";

const AT = new Date("2026-03-04T12:00:00Z");

// A valid action per game, derived from the round itself (never hardcoded answers).
const strategy = {
  challenge: (game, round) => challenge.solve(round),
  prediction: () => ({ pick: "yes", confidence: 80 }),
  faction: (game, round) => ({ factionId: round.factions[0].id }),
  mystery: (game, round) => ({ suspectId: mystery.solve(round) }),
  economy: (game, round) => {
    // Capacity limits TOTAL units traded (bought + sold), and you cannot sell more than you bought.
    const best = [...round.goods].sort((a, b) => b.sell - b.buy - (a.sell - a.buy))[0];
    const budget = Math.floor(round.startingCoins / best.buy);
    const qty = Math.min(budget, Math.floor(round.capacity / 2));
    return { buy: [{ goodId: best.id, qty }], sell: [{ goodId: best.id, qty }] };
  },
};

describe("registry", () => {
  it("exposes exactly five games with unique ids", () => {
    expect(gameIds()).toHaveLength(5);
    expect(new Set(gameIds()).size).toBe(5);
  });

  it("every game implements the full module contract", () => {
    for (const game of registry) {
      expect(typeof game.meta.id).toBe("string");
      expect(typeof game.meta.title).toBe("string");
      expect(["daily", "weekly"]).toContain(game.meta.cadence);
      expect(Number.isInteger(game.meta.maxPoints)).toBe(true);
      expect(game.meta.maxPoints).toBeGreaterThan(0);
      expect(typeof game.roundFor).toBe("function");
      expect(typeof game.submit).toBe("function");
    }
  });

  it("rejects unknown game ids", () => {
    expect(gameById("nope")).toBeNull();
    expect(play(createLedger(), "nope", {}, AT)).toMatchObject({
      accepted: false,
      reason: "unknown-game",
    });
  });
});

describe("integration: play()", () => {
  for (const game of registry) {
    const id = game.meta.id;

    it(`${id}: awards points to a correct action exactly once`, () => {
      const round = game.roundFor(
        game.meta.cadence === "weekly" ? "2026-W10" : "2026-03-04",
      );
      const action = strategy[id](game, round);
      expect(action, `${id} has no test strategy`).toBeTruthy();

      const first = play(createLedger(), id, action, AT);
      expect(first.accepted).toBe(true);
      expect(first.points).toBeGreaterThan(0);
      expect(first.points).toBeLessThanOrEqual(game.meta.maxPoints);

      // Replaying the same action in the same period must pay nothing.
      const second = play(first.state, id, action, AT);
      expect(second.accepted).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(second.points).toBe(0);
      expect(pointsFor(second.state, id)).toBe(first.points);
    });

    it(`${id}: an invalid action does not consume the period`, () => {
      const rejected = play(createLedger(), id, { garbage: true }, AT);
      expect(rejected.accepted).toBe(false);
      expect(rejected.points).toBe(0);

      const round = game.roundFor(
        game.meta.cadence === "weekly" ? "2026-W10" : "2026-03-04",
      );
      const good = play(rejected.state, id, strategy[id](game, round), AT);
      expect(good.accepted).toBe(true);
      expect(good.points).toBeGreaterThan(0);
    });

    it(`${id}: never mutates the ledger it is given`, () => {
      const ledger = createLedger();
      const snapshot = JSON.stringify(ledger);
      play(ledger, id, strategy[id](game, game.roundFor("2026-03-04")), AT);
      expect(JSON.stringify(ledger)).toBe(snapshot);
    });
  }

  it("accumulates points across all five games", () => {
    let ledger = createLedger();
    for (const game of registry) {
      const round = game.roundFor("2026-03-04");
      ledger = play(ledger, game.meta.id, strategy[game.meta.id](game, round), AT).state;
    }
    expect(ledger.history).toHaveLength(5);
    expect(ledger.points).toBeGreaterThan(0);
    for (const id of gameIds()) expect(pointsFor(ledger, id)).toBeGreaterThan(0);
  });
});

describe("integration: one attempt per period", () => {
  // A wrong-but-well-formed answer must consume the day, otherwise a player could
  // brute-force the answer by resubmitting until it lands.
  const losing = {
    challenge: (game, round) => {
      for (const ops of [["+", "+"], ["-", "-"], ["*", "*"], ["+", "-"], ["-", "+"]]) {
        const action = { numbers: round.pool.slice(0, 3), ops };
        if (game.submit(round, action).points === 0) return action;
      }
      throw new Error("no losing challenge action found");
    },
    prediction: (_game, round) => ({ pick: round.options?.[1]?.id ?? "no", confidence: 50 }),
    faction: (_game, round) => ({ factionId: round.factions[0].id }),
    mystery: (_game, round) => ({ suspectId: round.suspects[0].id }),
    economy: () => ({ buy: [], sell: [] }),
  };

  for (const game of registry) {
    const id = game.meta.id;
    it(`${id}: a wrong answer still records exactly one attempt`, () => {
      const round = game.roundFor("2026-03-04");
      const action = losing[id](game, round);

      const first = play(createLedger(), id, action, AT);
      expect(first.accepted).toBe(true);
      expect(first.points).toBeGreaterThanOrEqual(0);

      // Whatever the score, the day is spent: no second attempt is possible.
      const second = play(first.state, id, action, AT);
      expect(second.accepted).toBe(false);
      expect(second.duplicate).toBe(true);

      // Even a correct answer afterwards must be refused.
      const late = play(first.state, id, strategy[id](game, round), AT);
      expect(late.accepted).toBe(false);
      expect(late.duplicate).toBe(true);
    });
  }
});

describe("integration: spoiler safety", () => {
  for (const game of registry) {
    it(`${game.meta.id}: public round never contains the graded answer`, () => {
      const id = game.meta.id;
      if (id === "challenge") {
        const round = game.roundFor("2026-03-04");
        expect(JSON.stringify(round)).not.toContain("ops");
      }
      if (id === "mystery") {
        const round = game.roundFor("2026-03-04");
        // The culprit is one of the listed suspects, so its id legitimately appears.
        // What must never leak is a field that names the answer.
        expect(Object.keys(round)).not.toContain("culprit");
        expect(Object.keys(round)).not.toContain("excludes");
        expect(JSON.stringify(round)).not.toContain("culprit");
        expect(JSON.stringify(round)).not.toContain("excludes");
        expect(round.suspects).toHaveLength(4);
        expect(round.clues).toHaveLength(4);
      }
      if (id === "prediction") {
        const round = game.roundFor("2026-03-04");
        expect(Object.keys(round)).not.toContain("outcome");
      }
    });
  }
});