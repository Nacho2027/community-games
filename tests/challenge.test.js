import { describe, expect, it } from "vitest";
import {
  createLedger,
  progressFor,
  submitGuess,
} from "../src/engine/progress.js";
import { guess } from "../src/games/index.js";
import { judge, meta, roundFor, solve } from "../src/games/challenge.js";

const OPS = ["+", "-", "*"];
const AT = "2026-01-01T00:00:00.000Z";

function keys(count) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// Independent evaluator, written here rather than imported, so these tests cannot agree
// with the module by construction.
function leftToRight(numbers, ops) {
  let total = numbers[0];
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index] === "+") total += numbers[index + 1];
    else if (ops[index] === "-") total -= numbers[index + 1];
    else total *= numbers[index + 1];
  }
  return total;
}

// One move folded through the real engine, so attempt accounting and scoring are covered
// rather than just the game's own verdict. `periodKey` is passed explicitly because the
// engine owns it: a malformed round must still be rejected by the game's judge.
function play(ledger, round, action, periodKey = round?.periodKey) {
  return submitGuess(ledger, {
    gameId: meta.id,
    periodKey,
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

// A well-formed, in-pool guess that is guaranteed to miss the target.
function miss(round) {
  const { pool } = round;
  for (let i = 0; i < pool.length; i += 1)
    for (let j = 0; j < pool.length; j += 1) {
      if (j === i) continue;
      for (let k = 0; k < pool.length; k += 1) {
        if (k === i || k === j) continue;
        const numbers = [pool[i], pool[j], pool[k]];
        for (const first of OPS)
          for (const second of OPS) {
            const ops = [first, second];
            if (leftToRight(numbers, ops) !== round.target)
              return { numbers, ops };
          }
      }
    }
  return null;
}

const MANUAL = { periodKey: "manual", pool: [2, 3, 4, 9, 11, 13], target: 20 };

describe("challenge round content", () => {
  it("is deterministic for a period key", () => {
    expect(roundFor("2026-03-04")).toEqual(roundFor("2026-03-04"));
  });

  it("always produces a valid pool and target", () => {
    for (const key of keys(120)) {
      const round = roundFor(key);
      expect(round.pool).toHaveLength(6);
      expect(new Set(round.pool).size).toBe(6);
      expect(round.pool.every((value) => Number.isInteger(value))).toBe(true);
      expect(round.pool.every((value) => value >= 2 && value <= 25)).toBe(true);
      expect(Number.isInteger(round.target)).toBe(true);
      expect(round.target).toBeGreaterThan(0);
      expect(round.pool).not.toContain(round.target);
    }
  });

  it("does not leak the solution", () => {
    for (const key of keys(20)) {
      const round = roundFor(key);
      expect(Object.keys(round).sort()).toEqual([
        "periodKey",
        "pool",
        "target",
      ]);
      const serialized = JSON.stringify(round);
      expect(serialized).not.toContain("ops");
      expect(serialized).not.toContain("solution");
    }
  });

  it("declares the contract the engine relies on", () => {
    expect(meta.mode).toBe("solve");
    expect(meta.maxAttempts).toBeGreaterThan(1);
    expect(Number.isInteger(meta.maxPoints)).toBe(true);
  });
});

describe("challenge solvability", () => {
  it("is solvable by brute force for every generated round", () => {
    for (const key of keys(120)) {
      const solution = solve(roundFor(key));
      expect(solution, `no solution for ${key}`).not.toBeNull();
      // The brute-forced answer must satisfy the independent evaluator too.
      expect(leftToRight(solution.numbers, solution.ops)).toBe(
        roundFor(key).target,
      );
    }
  });

  it("pays the full ceiling for a first-attempt solve", () => {
    for (const key of keys(120)) {
      const round = roundFor(key);
      const outcome = play(createLedger(), round, solve(round));
      expect(outcome.accepted).toBe(true);
      expect(outcome.correct).toBe(true);
      expect(outcome.points).toBe(meta.maxPoints);
      expect(outcome.attemptsUsed).toBe(1);
      expect(outcome.finished).toBe(true);
    }
  });

  it("distinguishes a solve from a miss on a manual round", () => {
    const hit = play(createLedger(), MANUAL, {
      numbers: [13, 4, 3],
      ops: ["+", "+"],
    });
    expect(hit.correct).toBe(true);
    expect(hit.points).toBe(meta.maxPoints);

    const gone = play(createLedger(), MANUAL, miss(MANUAL));
    expect(gone.accepted).toBe(true);
    expect(gone.correct).toBe(false);
    expect(gone.points).toBe(0);
  });
});

describe("challenge scoring", () => {
  it("evaluates strictly left to right, not by precedence", () => {
    // 2 + 3 * 4 is 20 read left to right, and 14 under operator precedence.
    const action = { numbers: [2, 3, 4], ops: ["+", "*"] };
    expect(leftToRight(action.numbers, action.ops)).toBe(20);

    const outcome = play(createLedger(), MANUAL, action);
    expect(outcome.accepted).toBe(true);
    expect(outcome.correct).toBe(true);
    expect(outcome.reveal.computed).toBe(20);
  });

  it("costs an attempt for a well-formed but incorrect expression", () => {
    const outcome = play(createLedger(), MANUAL, {
      numbers: [2, 3, 4],
      ops: ["+", "+"],
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.points).toBe(0);
    expect(outcome.attemptsUsed).toBe(1);
    expect(outcome.finished).toBe(false);
    expect(outcome.feedback.state).toBe("wrong");
    expect(outcome.feedback.detail).toBe("11 too low");
  });

  it("tells the player which way they missed when they are close", () => {
    const low = play(createLedger(), MANUAL, {
      numbers: [9, 3, 4],
      ops: ["+", "+"],
    });
    expect(low.feedback.state).toBe("close");
    expect(low.feedback.detail).toBe("4 too low");

    const high = play(createLedger(), MANUAL, {
      numbers: [11, 9, 2],
      ops: ["+", "+"],
    });
    expect(high.feedback.state).toBe("close");
    expect(high.feedback.detail).toBe("2 too high");
  });

  it("pays less for a solve that takes more attempts", () => {
    const round = roundFor("2026-06-06");
    const solution = solve(round);
    const straight = play(createLedger(), round, solution);

    const { last: late } = playAll(round, [miss(round), miss(round), solution]);

    expect(late.correct).toBe(true);
    expect(late.attemptsUsed).toBe(3);
    expect(late.points).toBeLessThan(straight.points);
    expect(late.points).toBeGreaterThan(0);
  });

  it("keeps points whole and inside the ceiling for every move", () => {
    const round = roundFor("2026-08-08");
    let ledger = createLedger();
    for (let index = 0; index < meta.maxAttempts; index += 1) {
      const outcome = play(ledger, round, miss(round));
      expect(Number.isInteger(outcome.points)).toBe(true);
      expect(outcome.points).toBeGreaterThanOrEqual(0);
      expect(outcome.points).toBeLessThanOrEqual(meta.maxPoints);
      if (outcome.accepted) ledger = outcome.state;
    }
  });
});

describe("challenge attempt limits", () => {
  it("finishes the period with zero points once attempts run out", () => {
    const round = roundFor("2026-09-09");
    const actions = Array.from({ length: meta.maxAttempts }, () => miss(round));
    const { ledger, last } = playAll(round, actions);

    expect(last.accepted).toBe(true);
    expect(last.finished).toBe(true);
    expect(last.attemptsUsed).toBe(meta.maxAttempts);
    expect(last.attemptsLeft).toBe(0);

    const entry = progressFor(ledger, meta.id, round.periodKey);
    expect(entry.finished).toBe(true);
    expect(entry.solved).toBe(false);
    expect(entry.points).toBe(0);
  });

  it("refuses every further move once the period is finished", () => {
    const round = roundFor("2026-10-10");
    const actions = Array.from({ length: meta.maxAttempts }, () => miss(round));
    const { ledger } = playAll(round, actions);

    const after = play(ledger, round, solve(round));
    expect(after.accepted).toBe(false);
    expect(after.duplicate).toBe(true);
    expect(after.points).toBe(0);
    expect(progressFor(after.state, meta.id, round.periodKey).points).toBe(0);
  });

  it("does not finish a solved period early when guessing again", () => {
    const round = roundFor("2026-11-11");
    const first = play(createLedger(), round, solve(round));
    expect(first.finished).toBe(true);

    const again = play(first.state, round, solve(round));
    expect(again.accepted).toBe(false);
    expect(again.duplicate).toBe(true);
  });
});

describe("challenge validation", () => {
  const round = roundFor("2026-05-05");

  it("rejects reusing one number to satisfy multiplicity", () => {
    const repeated = round.pool[0];
    const outcome = play(createLedger(), round, {
      numbers: [repeated, repeated, repeated],
      ops: ["+", "+"],
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBeTypeOf("string");
  });

  it("rejects numbers outside the pool", () => {
    const outcome = play(createLedger(), round, {
      numbers: [1, 2, 3],
      ops: ["+", "+"],
    });
    expect(outcome.accepted).toBe(false);
  });

  it("costs no attempt when the move is malformed", () => {
    const malformed = [
      undefined,
      null,
      42,
      "12+34+44",
      {},
      { numbers: [1, 2] },
      { numbers: [1, 2, 3] },
      { numbers: [1, 2, 3], ops: ["+"] },
      { numbers: [1, 2, 3], ops: ["+", "/"] },
      { numbers: [1.5, 2, 3], ops: ["+", "+"] },
      { numbers: ["1", "2", "3"], ops: ["+", "+"] },
    ];
    for (const action of malformed) {
      const outcome = play(createLedger(), round, action);
      expect(outcome.accepted).toBe(false);
      expect(outcome.points).toBe(0);
      expect(outcome.reason).toBeTypeOf("string");
      // A rejected move must leave the day untouched, or brute force is free.
      expect(outcome.attemptsUsed).toBe(0);
      expect(progressFor(outcome.state, meta.id, round.periodKey)).toBeNull();
    }
  });

  it("rejects an invalid round object", () => {
    const action = { numbers: [1, 2, 3], ops: ["+", "+"] };
    for (const bad of [
      undefined,
      null,
      {},
      { pool: [1, 2] },
      { pool: [1, 2, 3], target: "10" },
    ]) {
      // Round validation lives in the game's judge, so drive it directly as well as
      // through the engine with a well-formed period key.
      expect(judge(bad, action).accepted).toBe(false);

      const outcome = play(createLedger(), bad, action, "manual");
      expect(outcome.accepted).toBe(false);
      expect(outcome.points).toBe(0);
      expect(outcome.attemptsUsed).toBe(0);
    }
  });
});

describe("challenge through the registry", () => {
  it("plays the real day through guess()", () => {
    const date = new Date(Date.UTC(2026, 2, 4));
    const round = roundFor("2026-03-04");
    const outcome = guess(createLedger(), meta.id, solve(round), date);
    expect(outcome.accepted).toBe(true);
    expect(outcome.points).toBe(meta.maxPoints);
  });

  it("rejects an unknown game", () => {
    const outcome = guess(createLedger(), "not-a-game", {}, new Date());
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe("unknown-game");
  });
});
