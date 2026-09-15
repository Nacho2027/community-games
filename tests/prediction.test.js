import { describe, expect, it } from "vitest";
import {
  createLedger,
  progressFor,
  submitGuess,
} from "../src/engine/progress.js";
import {
  roundFor as challengeRound,
  solve as challengeSolve,
} from "../src/games/challenge.js";
import {
  TEMPLATES,
  judge,
  meta,
  outcomeFor,
  roundFor,
} from "../src/games/prediction.js";

const AT = "2026-01-01T00:00:00.000Z";

function keys(count) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// Independent oracle: recompute each question's answer straight from the Numbers puzzle
// rather than trusting outcomeFor, so these tests cannot agree with the module by
// construction.
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

function truthFromPuzzle(periodKey, templateId) {
  const puzzle = challengeRound(periodKey);
  const solution = challengeSolve(puzzle);
  const oracle = ORACLES[templateId];
  if (!oracle) throw new Error(`unknown template ${templateId}`);
  if (!solution) return "no";
  return oracle(puzzle, solution) ? "yes" : "no";
}

// One move folded through the real engine. Prediction is a "series", so every attempt is
// played and the attempt number selects which question the move answers.
function play(ledger, round, action) {
  return submitGuess(ledger, {
    gameId: meta.id,
    periodKey: round.periodKey,
    round,
    action,
    judge,
    mode: meta.mode,
    maxAttempts: meta.maxAttempts,
    maxPoints: meta.maxPoints,
    now: AT,
  });
}

function playAll(round, actions) {
  let ledger = createLedger();
  let last = null;
  for (const action of actions) {
    last = play(ledger, round, action);
    if (last.accepted) ledger = last.state;
  }
  return { ledger, last };
}

function rightAnswer(round, index) {
  return outcomeFor(round.periodKey, round.questions[index].templateId);
}

function wrongAnswer(round, index) {
  return rightAnswer(round, index) === "yes" ? "no" : "yes";
}

describe("prediction round content", () => {
  it("is deterministic for a period key", () => {
    expect(roundFor("2026-07-09")).toEqual(roundFor("2026-07-09"));
  });

  it("asks exactly maxAttempts distinct questions with a stable shape", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      expect(Object.keys(round).sort()).toEqual(["periodKey", "questions"]);
      expect(round.questions).toHaveLength(meta.maxAttempts);

      const ids = new Set();
      for (const question of round.questions) {
        expect(Object.keys(question).sort()).toEqual([
          "id",
          "metric",
          "options",
          "question",
          "templateId",
        ]);
        expect(question.question.endsWith("?")).toBe(true);
        expect(question.options.map((option) => option.id)).toEqual([
          "yes",
          "no",
        ]);
        ids.add(question.templateId);
      }
      // Three copies of the same question would not be a series.
      expect(ids.size).toBe(meta.maxAttempts);
    }
  });

  it("never leaks the resolution outcome", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      expect("outcome" in round).toBe(false);
      expect("correct" in round).toBe(false);
      const serialized = JSON.stringify(round);
      expect(serialized).not.toContain("outcome");
      expect(serialized).not.toContain("correct");
      expect(serialized).not.toContain("ops");
    }
  });

  it("declares the contract the engine relies on", () => {
    expect(meta.mode).toBe("series");
    expect(meta.maxAttempts).toBe(3);
    expect(meta.maxPoints).toBe(100);
  });
});

describe("prediction resolution", () => {
  it("resolves from the Numbers puzzle instead of a coin flip", () => {
    // Regression: the outcome used to be an independent random draw, so the game had no
    // skill component and nothing a player could reason about.
    for (const key of keys(200)) {
      const round = roundFor(key);
      for (const question of round.questions) {
        expect(
          outcomeFor(key, question.templateId),
          `${key} ${question.templateId}`,
        ).toBe(truthFromPuzzle(key, question.templateId));
      }
    }
  });

  it("gives every template a non-degenerate base rate", () => {
    const buckets = new Map();
    for (const key of keys(1500)) {
      const question = roundFor(key).questions[0];
      const bucket = buckets.get(question.templateId) ?? { yes: 0, total: 0 };
      bucket.total += 1;
      if (truthFromPuzzle(key, question.templateId) === "yes") bucket.yes += 1;
      buckets.set(question.templateId, bucket);
    }

    expect(buckets.size).toBe(TEMPLATES.length);
    for (const [id, bucket] of buckets) {
      const rate = bucket.yes / bucket.total;
      // A question that is almost always yes or almost always no is not a prediction.
      const detail = `${id} resolved yes ${(rate * 100).toFixed(1)}%`;
      expect(rate, detail).toBeGreaterThan(0.2);
      expect(rate, detail).toBeLessThan(0.8);
    }
  });

  it("leaves no template stuck on one answer", () => {
    const seen = new Map();
    for (const key of keys(400)) {
      const question = roundFor(key).questions[0];
      const set = seen.get(question.templateId) ?? new Set();
      set.add(truthFromPuzzle(key, question.templateId));
      seen.set(question.templateId, set);
    }
    for (const [id, set] of seen) {
      expect(set.size, `${id} always resolves ${[...set][0]}`).toBe(2);
    }
  });
});

describe("prediction scoring", () => {
  it("pays the whole ceiling for a perfect, fully confident run", () => {
    for (const key of keys(40)) {
      const round = roundFor(key);
      const actions = round.questions.map((_, index) => ({
        pick: rightAnswer(round, index),
        confidence: 100,
      }));
      const { last } = playAll(round, actions);

      expect(last.accepted).toBe(true);
      expect(last.finished).toBe(true);
      expect(last.attemptsUsed).toBe(meta.maxAttempts);
      expect(progressFor(last.state, meta.id, round.periodKey).points).toBe(
        meta.maxPoints,
      );
    }
  });

  it("plays every question of the series, not just the first", () => {
    const round = roundFor("2026-04-04");
    const actions = round.questions.map((_, index) => ({
      pick: rightAnswer(round, index),
      confidence: 100,
    }));
    const { ledger, last } = playAll(round, actions);

    const entry = progressFor(ledger, meta.id, round.periodKey);
    expect(entry.guesses).toHaveLength(meta.maxAttempts);
    expect(entry.solved).toBe(true);
    expect(last.points).toBeGreaterThan(0);
  });

  it("keeps points whole and inside the ceiling for every legal setting", () => {
    for (const key of keys(40)) {
      const round = roundFor(key);
      for (let confidence = 50; confidence <= 100; confidence += 5) {
        for (const index of [0, 1, 2]) {
          const action = {
            pick: index % 2 === 0 ? "yes" : "no",
            confidence,
          };
          // Play the questions before `index` so the attempt number lines up.
          const lead = round.questions.slice(0, index).map((_, position) => ({
            pick: rightAnswer(round, position),
            confidence: 100,
          }));
          const { last } = playAll(round, [...lead, action]);
          expect(Number.isInteger(last.points)).toBe(true);
          expect(last.points).toBeGreaterThanOrEqual(0);
          expect(last.points).toBeLessThanOrEqual(meta.maxPoints);
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
      const outcome = play(createLedger(), round, action);
      expect(outcome.accepted).toBe(false);
      expect(outcome.points).toBe(0);
      expect(outcome.reason).toBeTypeOf("string");
      // A rejected move must not burn one of the three questions.
      expect(outcome.attemptsUsed).toBe(0);
      expect(progressFor(outcome.state, meta.id, round.periodKey)).toBeNull();
    }
  });

  it("accepts the exact confidence boundaries", () => {
    for (const confidence of [50, 100]) {
      const outcome = play(createLedger(), round, { pick: "yes", confidence });
      expect(outcome.accepted).toBe(true);
      expect(Number.isInteger(outcome.points)).toBe(true);
      expect(outcome.points).toBeGreaterThanOrEqual(0);
      expect(outcome.points).toBeLessThanOrEqual(meta.maxPoints);
    }
  });

  it("rejects an invalid round object", () => {
    const action = { pick: "yes", confidence: 70 };
    for (const bad of [
      undefined,
      null,
      {},
      { periodKey: 12 },
      { periodKey: "2026-02-02" },
    ]) {
      expect(
        judge(bad, action, { attempt: 1, maxAttempts: meta.maxAttempts })
          .accepted,
      ).toBe(false);
    }
  });

  it("rejects an attempt number outside the series", () => {
    const action = { pick: "yes", confidence: 70 };
    for (const attempt of [0, 4, 99]) {
      const verdict = judge(round, action, {
        attempt,
        maxAttempts: meta.maxAttempts,
      });
      expect(verdict.accepted).toBe(false);
      expect(verdict.reason).toBeTypeOf("string");
    }
  });
});

describe("prediction calibration", () => {
  // Regression the game already shipped with once: scoring was `correct ? confidence : 5`,
  // so expected value rose with confidence no matter what you believed and always answering
  // 100% was optimal. The slider was decorative. These tests exist to stop that returning.
  it("makes an interior confidence beat always answering 100% on every template", () => {
    const buckets = new Map();
    for (const key of keys(1500)) {
      const question = roundFor(key).questions[0];
      const bucket = buckets.get(question.templateId) ?? { days: [], yes: 0 };
      bucket.days.push(key);
      if (truthFromPuzzle(key, question.templateId) === "yes") bucket.yes += 1;
      buckets.set(question.templateId, bucket);
    }

    for (const [id, bucket] of buckets) {
      const rate = bucket.yes / bucket.days.length;
      const majority = rate >= 0.5 ? "yes" : "no";
      const averageAt = (confidence) =>
        bucket.days.reduce(
          (sum, key) =>
            sum +
            play(createLedger(), roundFor(key), { pick: majority, confidence })
              .points,
          0,
        ) / bucket.days.length;

      const certainty = averageAt(100);
      let best = { confidence: 100, points: certainty };
      for (let confidence = 50; confidence < 100; confidence += 5) {
        const points = averageAt(confidence);
        if (points > best.points) best = { confidence, points };
      }

      expect(
        best.points,
        `${id}: always answering 100% is still optimal ` +
          `(100% pays ${certainty.toFixed(2)}, best interior pays ${best.points.toFixed(2)})`,
      ).toBeGreaterThan(certainty);
      expect(
        best.confidence,
        `${id}: the best confidence should not be 100`,
      ).toBeLessThan(100);
    }
  });

  it("scores a wrong confident call below a wrong hedged one", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      const hedged = play(createLedger(), round, {
        pick: wrongAnswer(round, 0),
        confidence: 50,
      });
      const certain = play(createLedger(), round, {
        pick: wrongAnswer(round, 0),
        confidence: 100,
      });

      expect(hedged.correct).toBe(false);
      expect(certain.correct).toBe(false);
      expect(certain.points).toBeLessThan(hedged.points);
    }
  });
});
