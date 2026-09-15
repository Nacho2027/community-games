import { describe, expect, it } from "vitest";
import { meta, roundFor, solve, submit } from "../src/games/challenge.js";

function keys(count) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

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
      expect("ops" in round).toBe(false);
      expect("solution" in round).toBe(false);
      expect("numbers" in round).toBe(false);
      const serialized = JSON.stringify(round);
      expect(serialized).not.toContain("ops");
      expect(serialized).not.toContain("solution");
    }
  });
});

describe("challenge solvability", () => {
  it("is solvable by brute force for every generated round", () => {
    for (const key of keys(120)) {
      const solution = solve(roundFor(key));
      expect(solution, `no solution for ${key}`).not.toBeNull();
    }
  });

  it("awards max points for the brute-forced solution", () => {
    for (const key of keys(120)) {
      const round = roundFor(key);
      const verdict = submit(round, solve(round));
      expect(verdict.accepted).toBe(true);
      expect(verdict.points).toBe(meta.maxPoints);
      expect(verdict.points).toBeLessThanOrEqual(meta.maxPoints);
      expect(verdict.reveal.solved).toBe(true);
    }
  });
});

describe("challenge scoring", () => {
  it("evaluates strictly left to right, not by precedence", () => {
    const round = {
      periodKey: "manual",
      pool: [2, 3, 4, 9, 11, 13],
      target: 20,
    };
    const verdict = submit(round, { numbers: [2, 3, 4], ops: ["+", "*"] });
    expect(verdict.accepted).toBe(true);
    expect(verdict.points).toBe(meta.maxPoints);
    expect(verdict.result.computed).toBe(20);
  });

  it("consumes the attempt for a well-formed but incorrect expression", () => {
    const round = {
      periodKey: "manual",
      pool: [2, 3, 4, 9, 11, 13],
      target: 999,
    };
    const verdict = submit(round, { numbers: [2, 3, 4], ops: ["+", "+"] });
    // Accepted with 0 points: a wrong answer must still use up today's attempt.
    expect(verdict.accepted).toBe(true);
    expect(verdict.points).toBe(0);
    expect(verdict.reveal.solved).toBe(false);
    expect(verdict.result.computed).toBe(9);
  });
});

describe("challenge validation", () => {
  const round = roundFor("2026-05-05");

  it("rejects reusing one number to satisfy multiplicity", () => {
    const repeated = round.pool[0];
    const verdict = submit(round, {
      numbers: [repeated, repeated, repeated],
      ops: ["+", "+"],
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("not-in-pool");
  });

  it("rejects numbers outside the pool", () => {
    const verdict = submit(round, { numbers: [1, 2, 3], ops: ["+", "+"] });
    expect(verdict.accepted).toBe(false);
  });

  it("rejects malformed actions without throwing", () => {
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
      const verdict = submit(round, action);
      expect(verdict.accepted).toBe(false);
      expect(verdict.points).toBe(0);
      expect(verdict.reason).toBeTypeOf("string");
    }
  });

  it("rejects an invalid round object", () => {
    for (const bad of [
      undefined,
      null,
      {},
      { pool: [1, 2] },
      { pool: [1, 2, 3], target: "10" },
    ]) {
      const verdict = submit(bad, { numbers: [1, 2, 3], ops: ["+", "+"] });
      expect(verdict.accepted).toBe(false);
      expect(verdict.points).toBe(0);
    }
  });
});
