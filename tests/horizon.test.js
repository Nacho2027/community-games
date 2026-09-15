import { describe, expect, it } from "vitest";
import { registry, gameById } from "../src/games/index.js";
import * as challenge from "../src/games/challenge.js";
import * as mystery from "../src/games/mystery.js";
import * as economy from "../src/games/economy.js";

// A daily game is only as good as its worst day. A single degenerate round on the live
// site is a broken day for every player at once, so sweep a decade of days instead of
// the handful of periods the per-game tests use.
const DAYS = 3660; // ten years, leap days included

function horizon(count = DAYS) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

const KEY = "2026-01-01";

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

  it("Community Market always leaves a profitable trade and never exceeds its ceiling", () => {
    const broken = [];
    for (const key of horizon()) {
      const round = economy.roundFor(key);
      const verdict = economy.submit(round, economy.bestAction(round));
      if (
        !verdict.accepted ||
        verdict.points <= 0 ||
        verdict.points > economy.meta.maxPoints
      )
        broken.push(key);
    }
    expect(broken).toEqual([]);
  });

  it("no game ever awards points outside [0, maxPoints]", () => {
    const offenders = [];
    for (const key of horizon(400)) {
      for (const game of registry) {
        const round = game.roundFor(key);
        // Submit every legal option and check the bound holds for each.
        const options =
          game.meta.id === "challenge"
            ? [challenge.solve(round)]
            : game.meta.id === "mystery"
              ? round.suspects.map((suspect) => ({ suspectId: suspect.id }))
              : game.meta.id === "faction"
                ? round.factions.map((faction) => ({ factionId: faction.id }))
                : game.meta.id === "economy"
                  ? [economy.bestAction(round), { buy: [], sell: [] }]
                  : [
                      { pick: "yes", confidence: 100 },
                      { pick: "no", confidence: 100 },
                    ];
        for (const action of options) {
          const verdict = game.submit(round, action);
          if (verdict.accepted === false) continue;
          if (
            !Number.isInteger(verdict.points) ||
            verdict.points < 0 ||
            verdict.points > game.meta.maxPoints
          )
            offenders.push(`${game.meta.id} ${key} -> ${verdict.points}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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
});

describe("registry wiring", () => {
  it("resolves every advertised game id", () => {
    for (const game of registry) {
      expect(gameById(game.meta.id)).toBe(game);
    }
  });

  it("keeps the platform-neutral play() path consistent for all five games", () => {
    const ids = registry.map((game) => game.meta.id);
    expect(ids).toEqual([
      "challenge",
      "prediction",
      "faction",
      "mystery",
      "economy",
    ]);
    expect(gameById("challenge").roundFor(KEY)).toEqual(
      challenge.roundFor(KEY),
    );
  });
});
