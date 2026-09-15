import { describe, expect, it } from "vitest";
import { meta, roundFor, submit } from "../src/games/prediction.js";
import {
  roundFor as challengeRound,
  solve as challengeSolve,
} from "../src/games/challenge.js";

function keys(count) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// The outcome is resolution data, so tests read it through submit rather than
// through any private helper.
function outcomeOf(periodKey) {
  return submit(roundFor(periodKey), { pick: "yes", confidence: 50 }).result
    .outcome;
}

describe("prediction round content", () => {
  it("is deterministic for a period key", () => {
    expect(roundFor("2026-07-09")).toEqual(roundFor("2026-07-09"));
  });

  it("offers exactly yes and no with a stable shape", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      expect(Object.keys(round).sort()).toEqual([
        "metric",
        "options",
        "periodKey",
        "question",
        "templateId",
      ]);
      expect(round.options.map((option) => option.id)).toEqual(["yes", "no"]);
      expect(round.question).toBeTypeOf("string");
      expect(round.question.length).toBeGreaterThan(10);
    }
  });

  it("never leaks the resolution outcome", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      expect("outcome" in round).toBe(false);
      expect("resolution" in round).toBe(false);
      expect("correct" in round).toBe(false);
      expect(JSON.stringify(round)).not.toContain("outcome");
    }
  });

  it("rotates through more than one template", () => {
    const templates = new Set(keys(40).map((key) => roundFor(key).templateId));
    expect(templates.size).toBeGreaterThan(1);
  });

  it("resolves close to an even split", () => {
    const outcomes = keys(200).map(outcomeOf);
    const yes = outcomes.filter((value) => value === "yes").length;
    expect(yes).toBeGreaterThan(70);
    expect(yes).toBeLessThan(130);
  });
});

describe("prediction scoring", () => {
  it("awards the stated confidence for a correct pick", () => {
    for (const key of keys(30)) {
      const round = roundFor(key);
      const outcome = outcomeOf(key);
      const confidence = 80;
      const verdict = submit(round, { pick: outcome, confidence });
      expect(verdict.accepted).toBe(true);
      expect(verdict.points).toBe(confidence);
      expect(verdict.result.correct).toBe(true);
      expect(verdict.result.outcome).toBe(outcome);
      expect(verdict.reveal.outcome).toBe(outcome);
    }
  });

  it("awards consolation points for an incorrect pick", () => {
    for (const key of keys(30)) {
      const round = roundFor(key);
      const outcome = outcomeOf(key);
      const wrong = outcome === "yes" ? "no" : "yes";
      const verdict = submit(round, { pick: wrong, confidence: 90 });
      expect(verdict.accepted).toBe(true);
      expect(verdict.points).toBe(5);
      expect(verdict.result.correct).toBe(false);
    }
  });

  it("always keeps points inside the allowed range", () => {
    for (const key of keys(60)) {
      for (const confidence of [50, 75, 100]) {
        for (const pick of ["yes", "no"]) {
          const verdict = submit(roundFor(key), { pick, confidence });
          expect(Number.isInteger(verdict.points)).toBe(true);
          expect(verdict.points).toBeGreaterThanOrEqual(0);
          expect(verdict.points).toBeLessThanOrEqual(meta.maxPoints);
        }
      }
    }
  });
});

describe("prediction validation", () => {
  const round = roundFor("2026-02-02");

  it("rejects malformed actions without throwing", () => {
    const malformed = [
      undefined,
      null,
      7,
      "yes",
      {},
      { pick: "maybe", confidence: 70 },
      { pick: "yes" },
      { pick: "yes", confidence: 49 },
      { pick: "yes", confidence: 101 },
      { pick: "yes", confidence: 70.5 },
      { pick: "yes", confidence: "70" },
      { pick: "yes", confidence: Number.NaN },
      { pick: "yes", confidence: Number.POSITIVE_INFINITY },
    ];
    for (const action of malformed) {
      const verdict = submit(round, action);
      expect(verdict.accepted).toBe(false);
      expect(verdict.points).toBe(0);
      expect(verdict.reason).toBeTypeOf("string");
    }
  });

  it("accepts the exact confidence boundaries", () => {
    for (const confidence of [50, 100]) {
      const verdict = submit(round, { pick: "yes", confidence });
      expect(verdict.accepted).toBe(true);
      expect(verdict.points).toBeGreaterThan(0);
    }
  });

  it("rejects an invalid round object", () => {
    for (const bad of [undefined, null, {}, { periodKey: 12 }]) {
      const verdict = submit(bad, { pick: "yes", confidence: 70 });
      expect(verdict.accepted).toBe(false);
      expect(verdict.points).toBe(0);
    }
  });
});

describe("prediction resolution", () => {
  // Independent oracle: recompute the expected answer straight from the Numbers puzzle
  // instead of trusting the prediction module.
  const ORACLES = {
    multiply: (_round, solution) => solution.ops.includes("*"),
    subtract: (_round, solution) => solution.ops.includes("-"),
    largest: (round, solution) =>
      Math.max(...round.pool) === Math.max(...solution.numbers),
    aboveTarget: (round, solution) =>
      solution.numbers.reduce((sum, value) => sum + value, 0) > round.target,
    evenCount: (_round, solution) =>
      solution.numbers.filter((value) => value % 2 === 0).length >= 2,
    product: (_round, solution) =>
      solution.numbers.reduce((sum, value) => sum + value, 0) % 2 === 0,
  };

  it("resolves from the Numbers puzzle instead of a coin flip", () => {
    // Regression: the outcome used to come from an independent random draw, so the
    // game had no skill component and nothing a player could reason about.
    for (const key of keys(120)) {
      const round = roundFor(key);
      const puzzle = challengeRound(key);
      const solution = challengeSolve(puzzle);
      const oracle = ORACLES[round.templateId];
      expect(oracle, `unknown template ${round.templateId}`).toBeTruthy();
      const expected = oracle(puzzle, solution) ? "yes" : "no";
      expect(outcomeOf(key), `${key} ${round.templateId}`).toBe(expected);
    }
  });

  it("gives every template a non-degenerate base rate", () => {
    const buckets = new Map();
    for (const key of keys(1200)) {
      const round = roundFor(key);
      const bucket = buckets.get(round.templateId) ?? { yes: 0, total: 0 };
      bucket.total += 1;
      if (outcomeOf(key) === "yes") bucket.yes += 1;
      buckets.set(round.templateId, bucket);
    }

    expect(buckets.size).toBeGreaterThanOrEqual(4);
    for (const [id, bucket] of buckets) {
      const rate = bucket.yes / bucket.total;
      // A question that is almost always yes or almost always no is not a prediction.
      expect(rate, `${id} resolved yes ${(rate * 100).toFixed(1)}%`).toBeGreaterThan(0.2);
      expect(rate, `${id} resolved yes ${(rate * 100).toFixed(1)}%`).toBeLessThan(0.8);
    }
  });

  it("asks about the puzzle rather than stating an answer", () => {
    for (const key of keys(40)) {
      const round = roundFor(key);
      expect(round.question.endsWith("?")).toBe(true);
      // The question may mention the solution, but the payload carries no answer field.
      expect(Object.keys(round).sort()).toEqual([
        "metric",
        "options",
        "periodKey",
        "question",
        "templateId",
      ]);
      const serialized = JSON.stringify(round);
      expect(serialized).not.toContain("outcome");
      expect(serialized).not.toContain("correct");
      expect(serialized).not.toContain("ops");
    }
  });

  it("does not encode the answer in the template", () => {
    // If the answer followed from the template id alone, the round would leak it.
    const answers = new Map();
    for (const key of keys(200)) {
      const round = roundFor(key);
      const seen = answers.get(round.templateId) ?? new Set();
      seen.add(outcomeOf(key));
      answers.set(round.templateId, seen);
    }
    for (const [id, seen] of answers) {
      expect(seen.size, `${id} always resolves ${[...seen][0]}`).toBe(2);
    }
  });
});
