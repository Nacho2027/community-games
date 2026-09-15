import { describe, expect, it } from "vitest";
import { maxPoints, meta, roundFor, submit } from "../src/games/faction.js";

const PERIOD = "2026-03-04";

function days(count, start = Date.UTC(2026, 0, 1)) {
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// Crowd totals exclude the player's backing bonus, so this is an independent oracle.
function crowdLeader(round) {
  let leader = null;
  let best = -1;
  for (const faction of round.factions) {
    let total = 0;
    for (const row of round.votes) total += row[faction.id];
    if (total > best) {
      best = total;
      leader = faction;
    }
  }
  return leader;
}

describe("faction round", () => {
  it("is deterministic for a period", () => {
    expect(roundFor(PERIOD)).toEqual(roundFor(PERIOD));
  });

  it("varies across periods", () => {
    expect(JSON.stringify(roundFor(PERIOD))).not.toEqual(
      JSON.stringify(roundFor("2026-03-05")),
    );
  });

  it("always resolves in favour of the player who backs the crowd leader", () => {
    for (const period of days(60)) {
      const round = roundFor(period);
      const leader = crowdLeader(round);
      const outcome = submit(round, { factionId: leader.id });
      expect(outcome.accepted).toBe(true);
      expect(outcome.points).toBe(maxPoints);
      expect(outcome.result.won).toBe(true);
      expect(outcome.result.winnerId).toBe(leader.id);
    }
  });

  it("keeps standings ordered by total and consistent with the winner", () => {
    const round = roundFor(PERIOD);
    const outcome = submit(round, { factionId: round.factions[2].id });
    const totals = outcome.result.standings.map((entry) => entry.total);
    expect(outcome.result.standings).toHaveLength(3);
    expect(Math.max(...totals)).toBe(
      outcome.result.standings.find(
        (entry) => entry.id === outcome.result.winnerId,
      ).total,
    );
  });

  it("awards points within the declared range", () => {
    for (const period of days(30)) {
      const round = roundFor(period);
      for (const faction of round.factions) {
        const outcome = submit(round, { factionId: faction.id });
        expect(Number.isInteger(outcome.points)).toBe(true);
        expect(outcome.points).toBeGreaterThanOrEqual(0);
        expect(outcome.points).toBeLessThanOrEqual(meta.maxPoints);
      }
    }
  });

  it("rejects an unknown faction without awarding points", () => {
    const outcome = submit(roundFor(PERIOD), { factionId: "f9" });
    expect(outcome.accepted).toBe(false);
    expect(outcome.points).toBe(0);
    expect(outcome.reason).toBe("unknown faction");
  });

  it("never throws on malformed input", () => {
    const round = roundFor(PERIOD);
    const bad = [
      null,
      undefined,
      {},
      [],
      "f0",
      7,
      { factionId: 42 },
      { faction: "f0" },
    ];
    for (const action of bad) {
      expect(() => submit(round, action)).not.toThrow();
      expect(submit(round, action).accepted).toBe(false);
      expect(submit(round, action).points).toBe(0);
    }
    for (const broken of [null, undefined, {}, [], "x", { factions: [] }]) {
      expect(() => submit(broken, { factionId: "f0" })).not.toThrow();
      expect(submit(broken, { factionId: "f0" }).accepted).toBe(false);
    }
  });

  it("does not leak the outcome before submission", () => {
    const round = roundFor(PERIOD);
    expect(round.winnerId).toBeUndefined();
    expect(round.answer).toBeUndefined();
    const dump = JSON.stringify(round).toLowerCase();
    expect(dump).not.toContain("winner");
    expect(dump).not.toContain("answer");
    expect(dump).not.toContain("solution");
  });
});
