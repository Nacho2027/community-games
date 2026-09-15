import { describe, expect, it } from "vitest";
import { attemptPoints, createLedger } from "../src/engine/progress.js";
import * as challenge from "../src/games/challenge.js";
import * as economy from "../src/games/economy.js";
import * as mystery from "../src/games/mystery.js";
import * as prediction from "../src/games/prediction.js";
import { gameById, guess, periodFor, registry } from "../src/games/index.js";

// Integration coverage for the attempt loop, driven through the same registry entry point
// every adapter and host uses. These are the invariants that matter to a player: a move
// costs exactly one attempt, a finished period cannot be replayed for points, and a
// malformed move costs nothing.

const DATE = new Date("2026-03-04T12:00:00Z");

function context(gameId) {
  const game = gameById(gameId);
  const periodKey = periodFor(game, DATE);
  return { game, periodKey, round: game.roundFor(periodKey) };
}

// Play a whole period, deriving each move from the round.
function playPeriod(gameId, actionFor) {
  const { game, periodKey, round } = context(gameId);
  const outcomes = [];
  let ledger = createLedger();

  for (let attempt = 0; attempt < game.meta.maxAttempts; attempt += 1) {
    const outcome = guess(
      ledger,
      gameId,
      actionFor(game, round, attempt),
      DATE,
    );
    outcomes.push(outcome);
    ledger = outcome.state;
    if (!outcome.accepted || outcome.finished) break;
  }
  return { game, periodKey, round, outcomes, ledger };
}

const WINNING_ACTIONS = {
  challenge: (_game, round) => challenge.solve(round),
  mystery: (_game, round) => ({ suspectId: mystery.solve(round) }),
  economy: (_game, round) => economy.bestAction(round),
  prediction: (_game, round, attempt) => ({
    pick: prediction.outcomeFor(
      round.periodKey,
      round.questions[attempt].templateId,
    ),
    confidence: 100,
  }),
  faction: (_game, round) => ({ factionId: round.factions[0].id }),
};

describe("attempt loop through the registry", () => {
  it("rejects an unknown game without touching the ledger", () => {
    const ledger = createLedger();
    const outcome = guess(ledger, "nope", {}, DATE);
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe("unknown-game");
    expect(outcome.state).toEqual(ledger);
  });

  it("pays the ceiling for a first-try solve in every solve-mode game", () => {
    for (const gameId of ["challenge", "mystery", "economy"]) {
      const { game, outcomes, ledger } = playPeriod(
        gameId,
        WINNING_ACTIONS[gameId],
      );
      expect(outcomes[0].accepted, gameId).toBe(true);
      expect(outcomes[0].correct, gameId).toBe(true);
      expect(outcomes[0].finished, gameId).toBe(true);
      expect(ledger.points, gameId).toBe(game.meta.maxPoints);
    }
  });

  it("pays the ceiling for a perfect series in Prediction League", () => {
    const { game, ledger } = playPeriod(
      "prediction",
      WINNING_ACTIONS.prediction,
    );
    expect(ledger.points).toBe(game.meta.maxPoints);
  });

  it("plays every game to a finished period within its attempt budget", () => {
    for (const game of registry) {
      const { periodKey, outcomes, ledger } = playPeriod(
        game.meta.id,
        WINNING_ACTIONS[game.meta.id],
      );
      expect(outcomes.length, game.meta.id).toBeLessThanOrEqual(
        game.meta.maxAttempts,
      );
      expect(outcomes.at(-1).finished, game.meta.id).toBe(true);

      const entry = ledger.progress[`${game.meta.id}:${periodKey}`];
      expect(entry.finished, game.meta.id).toBe(true);
      expect(entry.guesses.length, game.meta.id).toBeLessThanOrEqual(
        game.meta.maxAttempts,
      );
      expect(Number.isInteger(entry.points), game.meta.id).toBe(true);
      expect(entry.points, game.meta.id).toBeGreaterThanOrEqual(0);
      expect(entry.points, game.meta.id).toBeLessThanOrEqual(
        game.meta.maxPoints,
      );
    }
  });

  it("refuses a replay of a finished period and awards nothing", () => {
    for (const game of registry) {
      const { periodKey, ledger } = playPeriod(
        game.meta.id,
        WINNING_ACTIONS[game.meta.id],
      );
      const before = ledger.points;
      const replay = guess(
        ledger,
        game.meta.id,
        WINNING_ACTIONS[game.meta.id](game, game.roundFor(periodKey), 0),
        DATE,
      );

      expect(replay.accepted, game.meta.id).toBe(false);
      expect(replay.duplicate, game.meta.id).toBe(true);
      expect(replay.points, game.meta.id).toBe(0);
      expect(replay.state.points, game.meta.id).toBe(before);
    }
  });

  it("charges an attempt for a well-formed wrong move but never the period", () => {
    // The old model consumed the whole day on a wrong answer, which meant there was no
    // loop to play. Every game must now survive a wrong move.
    const losers = {
      challenge: (round) => ({
        numbers: round.pool.slice(0, 3),
        ops: ["+", "+"],
      }),
      mystery: (round) => ({ suspectId: round.suspects[0].id }),
      economy: () => ({ buy: [], sell: [] }),
      prediction: () => ({ pick: "yes", confidence: 50 }),
      faction: (round) => ({ factionId: round.factions[0].id }),
    };

    for (const game of registry) {
      const { periodKey, round } = context(game.meta.id);
      const wrong = losers[game.meta.id](round, 0);
      // Skip games where the "wrong" move happens to be right on this day.
      const probe = guess(createLedger(), game.meta.id, wrong, DATE);
      if (!probe.accepted) continue;

      const ledger = probe.state;
      const entry = ledger.progress[`${game.meta.id}:${periodKey}`];
      expect(entry.attemptsUsed, game.meta.id).toBe(1);
      expect(entry.guesses, game.meta.id).toHaveLength(1);
      // Still open unless the game ran out of attempts in one move.
      if (game.meta.maxAttempts > 1)
        expect(entry.finished, game.meta.id).toBe(false);
    }
  });

  it("does not consume an attempt for a malformed move", () => {
    const junk = {
      challenge: { numbers: [1, 2], ops: ["+"] },
      mystery: { suspectId: "nope" },
      economy: { buy: "yes", sell: 3 },
      prediction: { pick: "maybe", confidence: 500 },
      faction: { factionId: "f9" },
    };

    for (const game of registry) {
      const { periodKey } = context(game.meta.id);
      const outcome = guess(
        createLedger(),
        game.meta.id,
        junk[game.meta.id],
        DATE,
      );

      expect(outcome.accepted, game.meta.id).toBe(false);
      expect(outcome.points, game.meta.id).toBe(0);
      expect(
        outcome.state.progress[`${game.meta.id}:${periodKey}`],
        game.meta.id,
      ).toBeUndefined();
    }
  });

  it("never mutates the ledger it is handed", () => {
    const ledger = createLedger();
    const snapshot = JSON.stringify(ledger);
    guess(
      ledger,
      "challenge",
      WINNING_ACTIONS.challenge(
        challenge,
        challenge.roundFor(periodFor(challenge, DATE)),
        0,
      ),
      DATE,
    );
    expect(JSON.stringify(ledger)).toBe(snapshot);
  });

  it("keeps points equal to the sum of the history, never a stored number", () => {
    let ledger = createLedger();
    for (const game of registry) {
      const outcome = guess(
        ledger,
        game.meta.id,
        WINNING_ACTIONS[game.meta.id](
          game,
          game.roundFor(periodFor(game, DATE)),
          0,
        ),
        DATE,
      );
      if (outcome.accepted) ledger = outcome.state;
    }
    const summed = ledger.history.reduce(
      (total, entry) => total + entry.points,
      0,
    );
    expect(ledger.points).toBe(summed);
    expect(ledger.points).toBeGreaterThan(0);
  });

  it("leaks no answer-bearing key in any public round", () => {
    const forbidden = new Set([
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
    const walk = (value, path) => {
      if (Array.isArray(value))
        return value.forEach((item) => walk(item, path));
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbidden.has(key), `${path}.${key}`).toBe(false);
        walk(child, `${path}.${key}`);
      }
    };
    for (const game of registry)
      walk(game.roundFor("2026-03-04"), game.meta.id);
  });

  it("declares a mode, an attempt budget, and a reachable ceiling", () => {
    for (const game of registry) {
      expect(["solve", "series"], game.meta.id).toContain(game.meta.mode);
      expect(game.meta.maxAttempts, game.meta.id).toBeGreaterThan(0);
      expect(game.meta.maxPoints, game.meta.id).toBeGreaterThan(0);
      // A first-attempt solve is always worth the full ceiling.
      expect(
        attemptPoints(game.meta.maxPoints, 1, game.meta.maxAttempts),
        game.meta.id,
      ).toBe(game.meta.maxPoints);
    }
  });
});
