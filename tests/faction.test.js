import { describe, expect, it } from "vitest";
import { meta, roundFor, submit } from "../src/games/faction.js";

function keys(count) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// The strategy a player would use from the public board alone: back whoever led the
// opening turn. This is the strategy that used to win 100% of the time.
function backOpeningLeader(round) {
  const opening = round.openingVotes ?? {};
  return [...round.factions].sort(
    (a, b) => (opening[b.id] ?? 0) - (opening[a.id] ?? 0),
  )[0].id;
}

function winRate(strategy, count = 400) {
  let wins = 0;
  for (const key of keys(count)) {
    const round = roundFor(key);
    if (submit(round, { factionId: strategy(round) }).result.won) wins += 1;
  }
  return wins / count;
}

describe("faction round content", () => {
  it("is deterministic for a period key", () => {
    expect(roundFor("2026-07-09")).toEqual(roundFor("2026-07-09"));
  });

  it("publishes only the opening turn, never the rest of the war", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      // Regression: publishing every turn let the winner be computed from the board,
      // so the naive strategy won every single day.
      expect(Object.keys(round).sort()).toEqual([
        "factions",
        "openingVotes",
        "rule",
        "seed",
        "turns",
      ]);
      expect(round).not.toHaveProperty("votes");
      expect(round).not.toHaveProperty("totals");
      expect(round).not.toHaveProperty("strength");
      expect(round).not.toHaveProperty("winnerId");
      expect(round.openingVotes).toBeTruthy();
    }
  });

  it("offers exactly three distinct, named factions", () => {
    for (const key of keys(40)) {
      const round = roundFor(key);
      expect(round.factions).toHaveLength(3);
      expect(new Set(round.factions.map((faction) => faction.id)).size).toBe(3);
      expect(new Set(round.factions.map((faction) => faction.name)).size).toBe(
        3,
      );
    }
  });

  it("reports a five turn war", () => {
    expect(roundFor("2026-02-02").turns).toBe(5);
  });
});

describe("faction difficulty", () => {
  it("never lets the naive board read guarantee a win", () => {
    // Regression: this was 100% before the hidden turns were introduced.
    expect(winRate(backOpeningLeader)).toBeLessThan(0.9);
  });

  it("still rewards reading the opening turn over guessing", () => {
    const naive = winRate(backOpeningLeader);
    // A blind pick wins roughly one in three.
    expect(naive).toBeGreaterThan(0.55);
  });

  it("keeps a fair baseline for a blind pick", () => {
    let wins = 0;
    const count = 600;
    let index = 0;
    for (const key of keys(count)) {
      const round = roundFor(key);
      const pick = round.factions[index % round.factions.length].id;
      index += 1;
      if (submit(round, { factionId: pick }).result.won) wins += 1;
    }
    const rate = wins / count;
    // Your backing is worth one vote, so a blind pick must stay near one in three.
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.5);
  });
});

describe("faction scoring", () => {
  it("awards either maxPoints or nothing, never in between", () => {
    for (const key of keys(80)) {
      const round = roundFor(key);
      for (const faction of round.factions) {
        const verdict = submit(round, { factionId: faction.id });
        expect(verdict.accepted).toBe(true);
        expect([0, meta.maxPoints]).toContain(verdict.points);
        expect(verdict.result.playerFactionId).toBe(faction.id);
      }
    }
  });

  it("produces a consistent winner across every possible pick", () => {
    for (const key of keys(40)) {
      const round = roundFor(key);
      const winners = round.factions.map(
        (faction) => submit(round, { factionId: faction.id }).result.winnerId,
      );
      // The hidden war is fixed; only the one-vote tiebreak can shift the result.
      expect(new Set(winners).size).toBeLessThanOrEqual(2);
      for (const winner of winners)
        expect(round.factions.map((faction) => faction.id)).toContain(winner);
    }
  });

  it("reports standings for all three factions", () => {
    const round = roundFor("2026-03-04");
    const verdict = submit(round, { factionId: round.factions[0].id });
    expect(verdict.result.standings).toHaveLength(3);
    for (const row of verdict.result.standings) {
      expect(Number.isInteger(row.total)).toBe(true);
      expect(row.name).toBeTruthy();
    }
    expect(typeof verdict.reveal.message).toBe("string");
  });

  it("does not mutate the round it is given", () => {
    const round = roundFor("2026-03-04");
    const snapshot = JSON.stringify(round);
    submit(round, { factionId: round.factions[0].id });
    expect(JSON.stringify(round)).toBe(snapshot);
  });

  it("rejects unknown factions and malformed input", () => {
    const round = roundFor("2026-03-04");
    for (const action of [
      undefined,
      null,
      {},
      { factionId: "nope" },
      { factionId: 7 },
      [],
      "f0",
    ]) {
      const verdict = submit(round, action);
      expect(verdict.accepted).toBe(false);
      expect(verdict.points).toBe(0);
    }
    for (const bad of [
      undefined,
      null,
      {},
      { factions: [] },
      { factions: "x" },
    ]) {
      expect(submit(bad, { factionId: "f0" }).accepted).toBe(false);
    }
  });
});
