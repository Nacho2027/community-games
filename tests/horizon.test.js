import { describe, expect, it } from "vitest";
import { createLedger, keyFor, submitGuess } from "../src/engine/progress.js";
import * as challenge from "../src/games/challenge.js";
import * as economy from "../src/games/economy.js";
import * as mystery from "../src/games/mystery.js";
import { gameById, registry } from "../src/games/index.js";

// A daily game is only as good as its worst day. A single degenerate round on the live
// site is a broken day for every player at once, so sweep a decade of days rather than
// the handful of periods the per-game tests use.
const DAYS = 3660; // ten years, leap days included

function horizon(count = DAYS) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// Field names that would carry an answer. Prose may legitimately mention "today's
// solution", so check structure rather than string contents.
const FORBIDDEN_KEYS = new Set([
  "answer",
  "correct",
  "culprit",
  "culpritId",
  "excludes",
  "ops",
  "outcome",
  "solution",
  "strength",
  "totals",
  "votes",
  "winner",
  "winnerId",
]);

function keysOf(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keysOf(child, found);
    }
  }
  return found;
}

// How a competent player would act on a given attempt. Every returned action must be
// legal, otherwise the play-through would be testing rejection rather than scoring.
function actionFor(game, round, attempt) {
  if (game.meta.id === "challenge") {
    const solution = challenge.solve(round);
    return solution ? { numbers: solution.numbers, ops: solution.ops } : null;
  }
  if (game.meta.id === "mystery")
    return {
      suspectId: round.suspects[(attempt - 1) % round.suspects.length].id,
    };
  if (game.meta.id === "economy")
    return attempt === 1 ? economy.bestAction(round) : { buy: [], sell: [] };
  if (game.meta.id === "faction")
    return {
      factionId: round.factions[(attempt - 1) % round.factions.length].id,
    };
  if (game.meta.id === "prediction")
    return { pick: attempt % 2 === 0 ? "no" : "yes", confidence: 60 };
  return null;
}

function send(ledger, game, periodKey, round, action) {
  return submitGuess(ledger, {
    gameId: game.meta.id,
    periodKey,
    round,
    action,
    judge: game.judge,
    // challenge.js declares no mode; the engine defaults to "solve".
    mode: game.meta.mode ?? "solve",
    maxAttempts: game.meta.maxAttempts,
    maxPoints: game.meta.maxPoints,
    now: `${periodKey}T00:00:00.000Z`,
  });
}

// Play one game's period to completion through the real loop.
function playOut(game, periodKey) {
  const round = game.roundFor(periodKey);
  let ledger = createLedger();
  const deltas = [];
  let last = null;

  for (let attempt = 1; attempt <= game.meta.maxAttempts; attempt += 1) {
    const action = actionFor(game, round, attempt);
    if (!action) return { failed: "no-legal-action", round };
    const outcome = send(ledger, game, periodKey, round, action);
    if (!outcome.accepted) return { failed: outcome.reason, round };
    deltas.push(outcome.points);
    ledger = outcome.state;
    last = outcome;
    if (outcome.finished) break;
  }

  return { ledger, round, deltas, last, periodKey };
}

describe("ten-year round integrity", () => {
  it("every game produces a valid, leak-free round on every day", () => {
    for (const key of horizon()) {
      for (const game of registry) {
        const round = game.roundFor(key);
        expect(round, `${game.meta.id} ${key}`).toBeTruthy();
        expect(typeof round).toBe("object");
        for (const field of keysOf(round)) {
          expect(
            FORBIDDEN_KEYS.has(field),
            `${game.meta.id} ${key} exposed answer field "${field}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("Daily Numbers is solvable on every single day", () => {
    const unsolvable = horizon().filter(
      (key) => !challenge.solve(challenge.roundFor(key)),
    );
    expect(unsolvable).toEqual([]);
  });

  it("Daily Mystery narrows to exactly one suspect on every single day", () => {
    const ambiguous = horizon().filter((key) => {
      const round = mystery.roundFor(key);
      const culprit = mystery.solve(round);
      if (!culprit) return true;
      // Recompute the deduction independently: a clue rules out one attribute value, and
      // every suspect holds a distinct value, so it eliminates exactly one person.
      const excluded = new Set();
      for (const clue of round.clues) {
        const target = mystery.clueTarget(clue.text);
        if (!target) continue;
        for (const suspect of round.suspects)
          if (suspect[target.kind] === target.value) excluded.add(suspect.id);
      }
      const remaining = round.suspects.filter(
        (suspect) => !excluded.has(suspect.id),
      );
      return remaining.length !== 1 || remaining[0].id !== culprit;
    });
    expect(ambiguous).toEqual([]);
  });

  it("Community Market always leaves a profitable trade on the table", () => {
    const barren = horizon().filter(
      (key) => economy.bestProfit(economy.roundFor(key)) <= 0,
    );
    expect(barren).toEqual([]);
  });

  it("keeps every game deterministic across the horizon", () => {
    for (const key of horizon(300)) {
      for (const game of registry) {
        expect(JSON.stringify(game.roundFor(key))).toBe(
          JSON.stringify(game.roundFor(key)),
        );
      }
    }
  });

  it("ships a daily round for every game on a leap day", () => {
    for (const game of registry) {
      const round = game.roundFor("2028-02-29");
      expect(round, `${game.meta.id} leap day`).toBeTruthy();
    }
  });
});

describe("ten-year play loop", () => {
  it("every game can finish a period on every single day", () => {
    const stuck = [];
    for (const key of horizon()) {
      for (const game of registry) {
        const run = playOut(game, key);
        if (run.failed) {
          stuck.push(`${game.meta.id} ${key}: ${run.failed}`);
          continue;
        }
        const entry = run.ledger.progress[keyFor(game.meta.id, key)];
        if (!entry?.finished)
          stuck.push(`${game.meta.id} ${key}: never finished`);
      }
    }
    expect(stuck).toEqual([]);
  });

  it("never awards points outside [0, maxPoints] on any day", () => {
    const offenders = [];
    for (const key of horizon()) {
      for (const game of registry) {
        const run = playOut(game, key);
        if (run.failed) {
          offenders.push(`${game.meta.id} ${key}: ${run.failed}`);
          continue;
        }
        const entry = run.ledger.progress[keyFor(game.meta.id, key)];
        const ceiling = game.meta.maxPoints;

        if (
          !Number.isInteger(entry.points) ||
          entry.points < 0 ||
          entry.points > ceiling
        )
          offenders.push(`${game.meta.id} ${key} total ${entry.points}`);
        for (const delta of run.deltas)
          if (!Number.isInteger(delta) || delta < 0 || delta > ceiling)
            offenders.push(`${game.meta.id} ${key} delta ${delta}`);
        // The stored total must be exactly the sum of what each move paid.
        const summed = run.deltas.reduce((sum, value) => sum + value, 0);
        if (summed !== entry.points)
          offenders.push(`${game.meta.id} ${key} ${summed} != ${entry.points}`);
        // And the ledger-wide total must agree with its own history.
        const historyTotal = run.ledger.history.reduce(
          (sum, row) => sum + row.points,
          0,
        );
        if (historyTotal !== run.ledger.points)
          offenders.push(
            `${game.meta.id} ${key} ledger ${run.ledger.points} != ${historyTotal}`,
          );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rejects a duplicate move once the period has finished", () => {
    const reopened = [];
    for (const key of horizon(600)) {
      for (const game of registry) {
        const run = playOut(game, key);
        if (run.failed) {
          reopened.push(`${game.meta.id} ${key}: ${run.failed}`);
          continue;
        }
        const action = actionFor(game, run.round, 1);
        const extra = send(run.ledger, game, key, run.round, action);
        const entry = run.ledger.progress[keyFor(game.meta.id, key)];
        if (
          extra.accepted !== false ||
          extra.duplicate !== true ||
          extra.points !== 0
        )
          reopened.push(`${game.meta.id} ${key}: extra move was accepted`);
        if (
          extra.state.progress[keyFor(game.meta.id, key)].points !==
          entry.points
        )
          reopened.push(`${game.meta.id} ${key}: duplicate changed the score`);
      }
    }
    expect(reopened).toEqual([]);
  });

  it("pays the full ceiling for a first-attempt solve, every day", () => {
    // Regression: Community Market once advertised 40 points and topped out at 8.
    const short = [];
    for (const key of horizon(1200)) {
      const run = playOut(economy, key);
      const entry = run.ledger.progress[keyFor(economy.meta.id, key)];
      if (!entry.solved || entry.points !== economy.meta.maxPoints)
        short.push(`${key} -> ${entry.points}`);
    }
    expect(short).toEqual([]);

    const numbers = horizon(1200).filter((key) => {
      const entry = playOut(challenge, key).ledger.progress[
        keyFor(challenge.meta.id, key)
      ];
      return !entry.solved || entry.points !== challenge.meta.maxPoints;
    });
    expect(numbers).toEqual([]);
  });
});

describe("registry wiring", () => {
  it("resolves every advertised game id", () => {
    for (const game of registry) expect(gameById(game.meta.id)).toBe(game);
  });

  it("advertises exactly the five shipped games in a stable order", () => {
    expect(registry.map((game) => game.meta.id)).toEqual([
      "challenge",
      "prediction",
      "faction",
      "mystery",
      "economy",
    ]);
  });

  it("exposes a judge and a play loop shape for every game", () => {
    for (const game of registry) {
      expect(typeof game.judge).toBe("function");
      expect(typeof game.roundFor).toBe("function");
      expect(Number.isInteger(game.meta.maxPoints)).toBe(true);
      expect(game.meta.maxPoints).toBeGreaterThan(0);
      expect(Number.isInteger(game.meta.maxAttempts)).toBe(true);
      expect(game.meta.maxAttempts).toBeGreaterThan(0);
    }
  });

  it("only declares modes the engine understands", () => {
    for (const game of registry)
      expect([undefined, "solve", "series"]).toContain(game.meta.mode);
  });
});
