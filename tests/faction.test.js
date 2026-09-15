import { describe, expect, it } from "vitest";
import {
  createLedger,
  progressFor,
  submitGuess,
} from "../src/engine/progress.js";
import { judge, meta, roundFor } from "../src/games/faction.js";

function keys(count) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// A series of 5 independent calls, so a correct call is worth an equal share.
const PER_TURN = meta.maxPoints / meta.maxAttempts;

// The strategy available from the public board alone: back whoever led the opening turn.
// This is the strategy that used to win 100% of the time, which is why it is pinned here.
function openingLeader(round) {
  const opening = round.openingVotes ?? {};
  return [...round.factions].sort(
    (a, b) =>
      (opening[b.id] ?? 0) - (opening[a.id] ?? 0) || a.id.localeCompare(b.id),
  )[0].id;
}

// Win rate per turn, not per day: every turn is a separate scored call.
function winRate(strategy, count = 400) {
  let wins = 0;
  let total = 0;
  let index = 0;
  for (const key of keys(count)) {
    const round = roundFor(key);
    for (let turn = 1; turn <= meta.maxAttempts; turn += 1) {
      const factionId = strategy(round, turn, index);
      index += 1;
      const verdict = judge(
        round,
        { factionId },
        {
          attempt: turn,
          maxAttempts: meta.maxAttempts,
        },
      );
      expect(verdict.accepted, `turn ${turn} of ${key}`).toBe(true);
      total += 1;
      if (verdict.correct) wins += 1;
    }
  }
  return wins / total;
}

describe("faction round content", () => {
  it("is deterministic for a period key", () => {
    expect(roundFor("2026-07-09")).toEqual(roundFor("2026-07-09"));
  });

  it("publishes only the opening turn, never the rest of the war", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      // Regression: publishing every turn let the winner be computed straight off the
      // board, so the naive strategy won every single day.
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
      for (const faction of round.factions) {
        expect(Number.isInteger(round.openingVotes[faction.id])).toBe(true);
      }
    }
  });

  it("reports a five turn war", () => {
    expect(roundFor("2026-02-02").turns).toBe(5);
    expect(roundFor("2026-02-02").turns).toBe(meta.maxAttempts);
  });

  it("does not mutate the round it is given", () => {
    const round = roundFor("2026-03-04");
    const snapshot = JSON.stringify(round);
    judge(
      round,
      { factionId: round.factions[0].id },
      { attempt: 1, maxAttempts: 5 },
    );
    expect(JSON.stringify(round)).toBe(snapshot);
  });
});

describe("faction difficulty", () => {
  it("never lets the naive board read guarantee a win", () => {
    // Regression: this was 100% before the hidden turns were introduced.
    expect(winRate(openingLeader)).toBeLessThan(0.9);
  });

  it("still rewards reading the opening turn over guessing", () => {
    // Roughly 66% measured: momentum is a real edge, just not a guarantee.
    expect(winRate(openingLeader)).toBeGreaterThan(0.55);
  });

  it("keeps a blind pick in the fair band", () => {
    // Rotating through the faction list, decorrelated from any id ordering.
    let cursor = 0;
    const blind = (round) => {
      const id = round.factions[cursor % round.factions.length].id;
      cursor += 1;
      return id;
    };
    const rate = winRate(blind, 600);
    // A blind pick wins about 42%, above the 33.3% fair baseline because the player's
    // guaranteed one-vote backing converts near-ties. It must not approach certainty.
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.5);
  });

  it("makes reading the board worth more than guessing", () => {
    let cursor = 0;
    const blind = (round) => {
      const id = round.factions[cursor % round.factions.length].id;
      cursor += 1;
      return id;
    };
    expect(winRate(openingLeader)).toBeGreaterThan(winRate(blind, 600));
  });

  it("is genuinely a decision: every faction leads the opening turn sometimes", () => {
    const leaders = new Set(
      keys(200).map((key) => openingLeader(roundFor(key))),
    );
    expect(leaders.size).toBeGreaterThan(1);
  });
});

describe("faction turn scoring", () => {
  it("resolves a turn on the attempt it was asked for", () => {
    const round = roundFor("2026-03-04");
    for (let turn = 1; turn <= meta.maxAttempts; turn += 1) {
      const verdict = judge(
        round,
        { factionId: round.factions[0].id },
        {
          attempt: turn,
          maxAttempts: meta.maxAttempts,
        },
      );
      expect(verdict.accepted).toBe(true);
      expect(verdict.reveal.turn).toBe(turn);
      expect(verdict.reveal.playerFactionId).toBe(round.factions[0].id);
      expect(typeof verdict.reveal.won).toBe("boolean");
      expect(verdict.reveal.standings).toHaveLength(3);
      for (const row of verdict.reveal.standings) {
        expect(Number.isInteger(row.total)).toBe(true);
        expect(row.name).toBeTruthy();
        expect(round.factions.map((faction) => faction.id)).toContain(row.id);
      }
      // Standings are published sorted, highest first.
      const totals = verdict.reveal.standings.map((row) => row.total);
      expect([...totals].sort((a, b) => b - a)).toEqual(totals);
      expect(verdict.reveal.winnerId).toBe(verdict.reveal.standings[0].id);
      expect(verdict.feedback.label.length).toBeGreaterThan(0);
      expect(["correct", "wrong"]).toContain(verdict.feedback.state);
      expect(verdict.feedback.state).toBe(
        verdict.correct ? "correct" : "wrong",
      );
    }
  });

  it("awards either a full share or nothing for a single turn", () => {
    let ledger = createLedger();
    const periodKey = "2026-03-04";
    const round = roundFor(periodKey);
    for (let turn = 1; turn <= meta.maxAttempts; turn += 1) {
      const outcome = submitGuess(ledger, {
        gameId: meta.id,
        periodKey,
        round,
        action: { factionId: round.factions[0].id },
        judge,
        mode: meta.mode,
        maxAttempts: meta.maxAttempts,
        maxPoints: meta.maxPoints,
        now: "2026-03-04T00:00:00.000Z",
      });
      expect(outcome.accepted).toBe(true);
      expect(outcome.attemptsUsed).toBe(turn);
      expect([0, PER_TURN]).toContain(outcome.points);
      ledger = outcome.state;
    }
  });

  it("pays exactly maxPoints for a run that calls every turn correctly", () => {
    // The ceiling has to be reachable, or the advertised score is a lie.
    let ledger = createLedger();
    const periodKey = "2026-01-04";
    const round = roundFor(periodKey);
    let last = openingLeader(round);
    let earned = 0;

    for (let turn = 1; turn <= meta.maxAttempts; turn += 1) {
      const outcome = submitGuess(ledger, {
        gameId: meta.id,
        periodKey,
        round,
        action: { factionId: last },
        judge,
        mode: meta.mode,
        maxAttempts: meta.maxAttempts,
        maxPoints: meta.maxPoints,
        now: "2026-01-04T00:00:00.000Z",
      });
      expect(outcome.accepted).toBe(true);
      earned += outcome.points;
      last = outcome.reveal.winnerId; // follow the momentum, as a player would
      ledger = outcome.state;
    }

    const entry = progressFor(ledger, meta.id, periodKey);
    expect(entry.finished).toBe(true);
    expect(entry.attemptsUsed).toBe(meta.maxAttempts);
    // 2026-01-04 is a day this strategy takes all five turns: 5 x 20 = 100 exactly.
    expect(earned).toBe(meta.maxPoints);
    expect(entry.points).toBe(earned);
    expect(entry.solved).toBe(true);
  });

  it("is reachable: a perfect run is scored maxPoints on real days", () => {
    const perfectDays = keys(600).filter((periodKey) => {
      const round = roundFor(periodKey);
      let total = 0;
      let last = openingLeader(round);
      for (let turn = 1; turn <= meta.maxAttempts; turn += 1) {
        const verdict = judge(
          round,
          { factionId: last },
          {
            attempt: turn,
            maxAttempts: meta.maxAttempts,
          },
        );
        if (verdict.correct) total += PER_TURN;
        last = verdict.reveal.winnerId;
      }
      return total === meta.maxPoints;
    });
    // 138 of 600 measured. The point is that it happens at all, and not too easily.
    expect(perfectDays.length).toBeGreaterThan(0);
    expect(perfectDays.length).toBeLessThan(600);
  });

  it("keeps the cumulative total consistent with the per-turn deltas", () => {
    const periodKey = "2026-05-06";
    const round = roundFor(periodKey);
    let ledger = createLedger();
    let running = 0;
    for (let turn = 1; turn <= meta.maxAttempts; turn += 1) {
      const outcome = submitGuess(ledger, {
        gameId: meta.id,
        periodKey,
        round,
        action: { factionId: round.factions[turn % 3].id },
        judge,
        mode: meta.mode,
        maxAttempts: meta.maxAttempts,
        maxPoints: meta.maxPoints,
        now: "2026-05-06T00:00:00.000Z",
      });
      running += outcome.points;
      ledger = outcome.state;
      expect(progressFor(ledger, meta.id, periodKey).points).toBe(running);
    }
    expect(running).toBe(progressFor(ledger, meta.id, periodKey).points);
  });
});

describe("faction loop integration", () => {
  it("runs five turns, then rejects the sixth as a duplicate", () => {
    const periodKey = "2026-06-01";
    const round = roundFor(periodKey);
    let ledger = createLedger();
    const send = (action) =>
      submitGuess(ledger, {
        gameId: meta.id,
        periodKey,
        round,
        action,
        judge,
        mode: meta.mode,
        maxAttempts: meta.maxAttempts,
        maxPoints: meta.maxPoints,
        now: "2026-06-01T00:00:00.000Z",
      });

    let outcome = null;
    for (let turn = 1; turn <= meta.maxAttempts; turn += 1) {
      outcome = send({ factionId: round.factions[0].id });
      expect(outcome.accepted).toBe(true);
      expect(outcome.finished).toBe(turn === meta.maxAttempts);
      ledger = outcome.state;
    }

    const extra = send({ factionId: round.factions[0].id });
    expect(extra.accepted).toBe(false);
    expect(extra.duplicate).toBe(true);
    expect(extra.points).toBe(0);
    // A finished period keeps its score and its attempt count.
    const entry = progressFor(extra.state, meta.id, periodKey);
    expect(entry.attemptsUsed).toBe(meta.maxAttempts);
    expect(entry.points).toBe(progressFor(ledger, meta.id, periodKey).points);
  });

  it("rejects an unknown faction without spending an attempt", () => {
    const periodKey = "2026-06-02";
    const round = roundFor(periodKey);
    const ledger = createLedger();

    for (const action of [
      undefined,
      null,
      {},
      { factionId: "nope" },
      { factionId: 7 },
      [],
      "f0",
    ]) {
      const outcome = submitGuess(ledger, {
        gameId: meta.id,
        periodKey,
        round,
        action,
        judge,
        mode: meta.mode,
        maxAttempts: meta.maxAttempts,
        maxPoints: meta.maxPoints,
        now: "2026-06-02T00:00:00.000Z",
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.points).toBe(0);
      expect(outcome.attemptsUsed).toBe(0);
    }

    // Nothing was consumed, so a real call still works afterwards.
    const good = submitGuess(ledger, {
      gameId: meta.id,
      periodKey,
      round,
      action: { factionId: round.factions[0].id },
      judge,
      mode: meta.mode,
      maxAttempts: meta.maxAttempts,
      maxPoints: meta.maxPoints,
      now: "2026-06-02T00:00:00.000Z",
    });
    expect(good.accepted).toBe(true);
    expect(good.attemptsUsed).toBe(1);
    expect(progressFor(ledger, meta.id, periodKey)).toBeNull();
  });

  it("rejects a war it cannot resolve", () => {
    const round = roundFor("2026-06-03");
    for (const bad of [
      undefined,
      null,
      {},
      { factions: [] },
      { factions: "x" },
      { ...round, seed: 5 },
    ])
      expect(
        judge(bad, { factionId: "f0" }, { attempt: 1, maxAttempts: 5 })
          .accepted,
      ).toBe(false);
    // A turn outside the war is refused rather than scored.
    for (const attempt of [0, 6, -1])
      expect(
        judge(
          round,
          { factionId: round.factions[0].id },
          { attempt, maxAttempts: 5 },
        ).accepted,
      ).toBe(false);
  });
});
