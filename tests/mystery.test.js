import { describe, expect, it } from "vitest";
import {
  excludedBy,
  maxPoints,
  meta,
  roundFor,
  solve,
  submit,
} from "../src/games/mystery.js";

const PERIOD = "2026-03-04";

function days(count, start = Date.UTC(2026, 0, 1)) {
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

describe("mystery round", () => {
  it("is deterministic for a period", () => {
    expect(roundFor(PERIOD)).toEqual(roundFor(PERIOD));
  });

  it("presents four suspects and four clues", () => {
    const round = roundFor(PERIOD);
    expect(round.suspects).toHaveLength(4);
    expect(round.clues).toHaveLength(4);
    expect(new Set(round.suspects.map((suspect) => suspect.id)).size).toBe(4);
  });

  it("is uniquely solvable once the clues are applied", () => {
    const round = roundFor(PERIOD);
    const excluded = excludedBy(round);
    const remaining = round.suspects.filter(
      (suspect) => !excluded.has(suspect.id),
    );
    expect(excluded.size).toBe(3);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(solve(round));
  });

  it("stays uniquely solvable across 120 periods", () => {
    for (const period of days(120)) {
      const round = roundFor(period);
      const excluded = excludedBy(round);
      const remaining = round.suspects.filter(
        (suspect) => !excluded.has(suspect.id),
      );
      expect(remaining).toHaveLength(1);
      expect(solve(round)).toBe(remaining[0].id);
      expect(
        round.suspects.some((suspect) => suspect.id === solve(round)),
      ).toBe(true);
    }
  });

  it("does not leak the culprit before submission", () => {
    const round = roundFor(PERIOD);
    expect(round.culpritId).toBeUndefined();
    expect(round.excludes).toBeUndefined();
    const dump = JSON.stringify(round).toLowerCase();
    expect(dump).not.toContain("culprit");
    expect(dump).not.toContain("answer");
    expect(dump).not.toContain("excludes");
    expect(dump).not.toContain("solution");
  });

  it("scores the correct accusation at maxPoints", () => {
    for (const period of days(30)) {
      const round = roundFor(period);
      const outcome = submit(round, { suspectId: solve(round) });
      expect(outcome.accepted).toBe(true);
      expect(outcome.result.correct).toBe(true);
      expect(outcome.points).toBe(maxPoints);
    }
  });

  it("accepts a wrong accusation with zero points and reveals the culprit", () => {
    const round = roundFor(PERIOD);
    const culpritId = solve(round);
    const wrong = round.suspects.find((suspect) => suspect.id !== culpritId);
    const outcome = submit(round, { suspectId: wrong.id });
    expect(outcome.accepted).toBe(true);
    expect(outcome.points).toBe(0);
    expect(outcome.result.correct).toBe(false);
    expect(outcome.result.culpritId).toBe(culpritId);
  });

  it("never throws on malformed input", () => {
    const round = roundFor(PERIOD);
    for (const action of [
      null,
      undefined,
      {},
      [],
      "s0",
      3,
      { suspectId: 9 },
      { id: "s0" },
    ]) {
      expect(() => submit(round, action)).not.toThrow();
      expect(submit(round, action).accepted).toBe(false);
      expect(submit(round, action).points).toBe(0);
    }
    for (const broken of [null, undefined, {}, [], "x", { suspects: [] }]) {
      expect(() => submit(broken, { suspectId: "s0" })).not.toThrow();
      expect(submit(broken, { suspectId: "s0" }).accepted).toBe(false);
    }
    expect(solve(null)).toBe(null);
    expect(solve({ seed: 5 })).toBe(null);
  });

  it("declares a bounded score", () => {
    expect(meta.maxPoints).toBe(maxPoints);
    expect(Number.isInteger(maxPoints)).toBe(true);
    expect(maxPoints).toBeGreaterThan(0);
  });
});
