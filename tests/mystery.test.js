import { describe, expect, it } from "vitest";
import {
  ITEMS,
  LOCATIONS,
  clueTarget,
  excludedBy,
  meta,
  roundFor,
  solve,
  submit,
} from "../src/games/mystery.js";

function keys(count) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// Independent deduction built only from the published tables and the public round.
function deduce(round) {
  const excluded = new Set();
  for (const clue of round.clues) {
    const target = clueTarget(clue.text);
    if (!target) continue; // atmosphere clue, rules nobody out
    for (const suspect of round.suspects)
      if (suspect[target.kind] === target.value) excluded.add(suspect.id);
  }
  return round.suspects.filter((suspect) => !excluded.has(suspect.id));
}

describe("mystery round content", () => {
  it("is deterministic for a period key", () => {
    expect(roundFor("2026-07-09")).toEqual(roundFor("2026-07-09"));
  });

  it("publishes four suspects with distinct alibis and items", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      expect(round.suspects).toHaveLength(4);
      expect(new Set(round.suspects.map((suspect) => suspect.name)).size).toBe(
        4,
      );
      // Distinct attributes are what make a single clue eliminate exactly one person.
      expect(
        new Set(round.suspects.map((suspect) => suspect.whereabouts)).size,
      ).toBe(4);
      expect(
        new Set(round.suspects.map((suspect) => suspect.carried)).size,
      ).toBe(4);
    }
  });

  it("never names a suspect in the evidence", () => {
    // Regression: three of four suspects used to be named outright, so the "deduction"
    // was just spotting the one name that was missing. Every clue now describes a
    // condition, and the player must connect it to an alibi.
    for (const key of keys(400)) {
      const round = roundFor(key);
      for (const clue of round.clues)
        for (const suspect of round.suspects)
          expect(clue.text, `${key} named ${suspect.name}`).not.toContain(
            suspect.name,
          );
    }
  });

  it("never repeats the attribute it rules out", () => {
    for (const key of keys(400)) {
      const round = roundFor(key);
      for (const clue of round.clues)
        for (const suspect of round.suspects) {
          expect(clue.text).not.toContain(suspect.whereabouts);
          expect(clue.text).not.toContain(suspect.carried);
        }
    }
  });

  it("carries no answer field", () => {
    for (const key of keys(40)) {
      const round = roundFor(key);
      expect(Object.keys(round).sort()).toEqual(["clues", "seed", "suspects"]);
      expect(round).not.toHaveProperty("culprit");
      expect(round).not.toHaveProperty("culpritId");
      expect(round.clues).toHaveLength(4);
    }
  });

  it("uses the whole clue vocabulary rather than one template", () => {
    const used = new Set();
    for (const key of keys(400))
      for (const clue of roundFor(key).clues) used.add(clue.text);
    const vocabulary = LOCATIONS.length + ITEMS.length;
    expect(used.size).toBeGreaterThan(vocabulary * 0.5);
  });
});

describe("mystery solvability", () => {
  it("narrows to exactly one suspect on every day", () => {
    for (const key of keys(600)) {
      expect(deduce(roundFor(key)), key).toHaveLength(1);
    }
  });

  it("agrees with solve()", () => {
    for (const key of keys(600)) {
      const round = roundFor(key);
      expect(solve(round)).toBe(deduce(round)[0].id);
    }
  });

  it("rules out exactly the innocent suspects", () => {
    for (const key of keys(200)) {
      const round = roundFor(key);
      const excluded = excludedBy(round);
      expect(excluded.size).toBe(3);
      expect(excluded.has(solve(round))).toBe(false);
    }
  });

  it("returns null for a malformed round", () => {
    for (const bad of [undefined, null, {}, { seed: 5 }, { seed: "x" }]) {
      expect(solve(bad)).toBeNull();
    }
  });
});

describe("mystery scoring", () => {
  it("awards maxPoints for the culprit and nothing otherwise", () => {
    for (const key of keys(120)) {
      const round = roundFor(key);
      const culprit = solve(round);
      const right = submit(round, { suspectId: culprit });
      expect(right.accepted).toBe(true);
      expect(right.points).toBe(meta.maxPoints);
      expect(right.result.correct).toBe(true);

      for (const suspect of round.suspects.filter(
        (item) => item.id !== culprit,
      )) {
        const wrong = submit(round, { suspectId: suspect.id });
        expect(wrong.accepted).toBe(true);
        expect(wrong.points).toBe(0);
        expect(wrong.result.correct).toBe(false);
        // The reveal may name the culprit only after the accusation.
        expect(wrong.result.culpritId).toBe(culprit);
      }
    }
  });

  it("rejects malformed input without throwing", () => {
    const round = roundFor("2026-03-04");
    for (const action of [
      undefined,
      null,
      {},
      { suspectId: "nope" },
      { suspectId: 7 },
      [],
    ]) {
      const verdict = submit(round, action);
      expect(verdict.accepted).toBe(false);
      expect(verdict.points).toBe(0);
    }
    for (const bad of [undefined, null, {}, { seed: "x" }]) {
      expect(submit(bad, { suspectId: "s0" }).accepted).toBe(false);
    }
  });

  it("does not mutate the round it is given", () => {
    const round = roundFor("2026-03-04");
    const snapshot = JSON.stringify(round);
    submit(round, { suspectId: round.suspects[0].id });
    expect(JSON.stringify(round)).toBe(snapshot);
  });
});
