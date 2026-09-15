import { describe, expect, it } from "vitest";
import {
  ITEMS,
  LOCATIONS,
  clueTarget,
  excludedBy,
  judge,
  meta,
  roundFor,
  solve,
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

const JUNK_ACTIONS = [
  undefined,
  null,
  {},
  [],
  "s0",
  7,
  true,
  { suspectId: 7 },
  { suspectId: null },
  { suspect: "s0" },
  { id: "s0" },
];

describe("mystery meta", () => {
  it("runs the solve loop with two accusations", () => {
    expect(meta.id).toBe("mystery");
    expect(meta.mode).toBe("solve");
    expect(meta.cadence).toBe("daily");
    expect(meta.maxAttempts).toBe(2);
    expect(meta.maxPoints).toBe(100);
  });

  it("keeps the deduction worth more than guessing", () => {
    // This replaces a weak guard: `maxAttempts < suspects + 1` (3 < 5) passed while a
    // player who ignored every clue still won 75% of the time, because each wrong
    // accusation clears a suspect and narrows the field for free. Proxy assertions are
    // how this project shipped unplayable games, so measure the actual rate.
    const suspects = roundFor("2026-03-04").suspects.length;
    let blind = 0;
    let carried = 1;
    for (let index = 0; index < meta.maxAttempts; index += 1) {
      blind += carried * (1 / (suspects - index));
      carried *= (suspects - (index + 1)) / (suspects - index);
    }

    expect(suspects).toBeGreaterThan(meta.maxAttempts);
    expect(blind).toBeGreaterThan(0.25);
    expect(blind).toBeLessThan(0.45);
    // Following the evidence must beat ignoring it, by a clear margin.
    expect(1 - blind).toBeGreaterThan(blind);
  });
});

describe("mystery round content", () => {
  it("is deterministic for a period key", () => {
    expect(roundFor("2026-07-09")).toEqual(roundFor("2026-07-09"));
  });

  it("publishes six suspects with distinct alibis and items", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      expect(round.suspects).toHaveLength(6);
      expect(new Set(round.suspects.map((suspect) => suspect.name)).size).toBe(
        6,
      );
      // Distinct attributes are what make a single clue eliminate exactly one person.
      expect(
        new Set(round.suspects.map((suspect) => suspect.whereabouts)).size,
      ).toBe(6);
      expect(
        new Set(round.suspects.map((suspect) => suspect.carried)).size,
      ).toBe(6);
    }
  });

  it("never names a suspect in the evidence", () => {
    // Regression: three of four suspects used to be named outright, so the "deduction"
    // was just spotting the one name that was missing.
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
      expect(round.clues).toHaveLength(round.suspects.length);
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
      // One clue per innocent suspect, so every suspect but the culprit is ruled out.
      expect(excluded.size).toBe(round.suspects.length - 1);
      expect(excluded.has(solve(round))).toBe(false);
    }
  });

  it("returns null for a malformed round", () => {
    for (const bad of [
      undefined,
      null,
      {},
      { seed: 5 },
      { seed: "x" },
      [],
      "x",
    ]) {
      expect(solve(bad)).toBeNull();
    }
  });
});

describe("mystery judging", () => {
  const context = { attempt: 1, maxAttempts: meta.maxAttempts };

  it("accepts the culprit and reports a hit", () => {
    for (const key of keys(150)) {
      const round = roundFor(key);
      const culprit = solve(round);
      const verdict = judge(round, { suspectId: culprit }, context);

      expect(verdict.accepted).toBe(true);
      expect(verdict.correct).toBe(true);
      expect(verdict.feedback.state).toBe("correct");
      expect(verdict.feedback.detail).toBe("The evidence fits.");
      expect(verdict.feedback.label).toBe(
        round.suspects.find((suspect) => suspect.id === culprit).name,
      );
    }
  });

  it("clears the accused on a miss and names them in the detail", () => {
    for (const key of keys(150)) {
      const round = roundFor(key);
      const culprit = solve(round);
      for (const innocent of round.suspects.filter(
        (suspect) => suspect.id !== culprit,
      )) {
        const verdict = judge(round, { suspectId: innocent.id }, context);

        expect(verdict.accepted).toBe(true);
        expect(verdict.correct).toBe(false);
        expect(verdict.feedback.state).toBe("wrong");
        expect(verdict.feedback.label).toBe(innocent.name);
        // The hint has to name the suspect the evidence clears so the player can narrow.
        expect(verdict.feedback.detail).toContain(innocent.name);
        // It must not betray the answer.
        expect(verdict.feedback.detail).not.toContain(
          round.suspects.find((suspect) => suspect.id === culprit).name,
        );
      }
    }
  });

  it("counts down the accusations left in the hint", () => {
    const round = roundFor("2026-03-04");
    const innocent = round.suspects.find(
      (suspect) => suspect.id !== solve(round),
    );
    const first = judge(
      round,
      { suspectId: innocent.id },
      { attempt: 1, maxAttempts: 3 },
    );
    expect(first.feedback.detail).toContain("2 accusations left");

    const last = judge(
      round,
      { suspectId: innocent.id },
      { attempt: 3, maxAttempts: 3 },
    );
    expect(last.feedback.detail).toContain("No accusations left");
  });

  it("always returns a non-empty label", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      for (const suspect of round.suspects) {
        const verdict = judge(round, { suspectId: suspect.id }, context);
        expect(verdict.feedback.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("reveals the culprit and the cleared set only after a move", () => {
    const round = roundFor("2026-03-04");
    const culprit = solve(round);
    const verdict = judge(round, { suspectId: culprit }, context);

    expect(verdict.reveal.culpritId).toBe(culprit);
    expect(verdict.reveal.culpritName).toBe(
      round.suspects.find((suspect) => suspect.id === culprit).name,
    );
    expect(verdict.reveal.correct).toBe(true);
    expect(verdict.reveal.suspectId).toBe(culprit);
    expect(new Set(verdict.reveal.cleared)).toEqual(excludedBy(round));
  });

  it("rejects an unknown or missing suspect without throwing", () => {
    const round = roundFor("2026-03-04");
    for (const action of JUNK_ACTIONS) {
      let verdict;
      expect(
        () => {
          verdict = judge(round, action, context);
        },
        `threw on ${JSON.stringify(action)}`,
      ).not.toThrow();
      expect(verdict.accepted).toBe(false);
      expect(verdict.correct).toBe(false);
      expect(typeof verdict.reason).toBe("string");
      expect(verdict.reason.length).toBeGreaterThan(0);
      expect(verdict.feedback).toBeUndefined();
    }
  });

  it("rejects a malformed round without throwing", () => {
    const badRounds = [
      undefined,
      null,
      {},
      [],
      "x",
      7,
      { seed: "x" },
      { seed: "x", suspects: [] },
    ];
    for (const bad of badRounds) {
      let verdict;
      expect(() => {
        verdict = judge(bad, { suspectId: "s0" }, context);
      }).not.toThrow();
      expect(verdict.accepted).toBe(false);
    }
  });

  it("never throws when the context is missing or malformed", () => {
    const round = roundFor("2026-03-04");
    const culprit = solve(round);
    for (const ctx of [
      undefined,
      null,
      {},
      [],
      "x",
      7,
      { attempt: "x" },
      { maxAttempts: -1 },
    ]) {
      let verdict;
      expect(() => {
        verdict = judge(round, { suspectId: culprit }, ctx);
      }).not.toThrow();
      expect(verdict.accepted).toBe(true);
      expect(verdict.correct).toBe(true);
      expect(verdict.feedback.detail.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate the round it is given", () => {
    const round = roundFor("2026-03-04");
    const snapshot = JSON.stringify(round);
    for (const suspect of round.suspects)
      judge(round, { suspectId: suspect.id }, context);
    expect(JSON.stringify(round)).toBe(snapshot);
  });

  it("judges the same move the same way regardless of order", () => {
    const round = roundFor("2026-02-11");
    const first = round.suspects.map((suspect) =>
      JSON.stringify(judge(round, { suspectId: suspect.id }, context)),
    );
    const reversed = [...round.suspects]
      .reverse()
      .map((suspect) =>
        JSON.stringify(judge(round, { suspectId: suspect.id }, context)),
      )
      .reverse();
    expect(reversed).toEqual(first);
  });
});
