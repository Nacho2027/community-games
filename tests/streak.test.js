import { describe, expect, it } from "vitest";
import { dailyStreak, playedDays, shareText } from "../src/engine/streak.js";
import { registry } from "../src/games/index.js";

function ledger(entries = []) {
  return {
    actions: {},
    history: entries.map(([periodKey, gameId = "challenge", points = 10]) => ({
      gameId,
      periodKey,
      points,
      at: `${periodKey}T00:00:00.000Z`,
    })),
    points: 0,
  };
}

function actionsFor(periodKey, points) {
  const actions = {};
  for (const game of registry) actions[`${game.meta.id}:${periodKey}`] = { gameId: game.meta.id, periodKey, points };
  return { actions, history: [], points: 0 };
}

const TODAY = new Date("2026-03-04T12:00:00Z");

describe("playedDays", () => {
  it("collects unique UTC days and ignores junk keys", () => {
    const days = playedDays(ledger([["2026-03-01"], ["2026-03-01"], ["2026-W10"], ["nope"]]));
    expect([...days]).toEqual(["2026-03-01"]);
  });

  it("tolerates an empty or missing ledger", () => {
    expect(playedDays(ledger()).size).toBe(0);
    expect(playedDays(undefined).size).toBe(0);
    expect(playedDays({}).size).toBe(0);
  });
});

describe("dailyStreak", () => {
  it("is zero with no history", () => {
    expect(dailyStreak(ledger(), TODAY)).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const state = ledger([["2026-03-04"], ["2026-03-03"], ["2026-03-02"]]);
    expect(dailyStreak(state, TODAY)).toBe(3);
  });

  it("still shows yesterday's streak before today is played", () => {
    const state = ledger([["2026-03-03"], ["2026-03-02"]]);
    expect(dailyStreak(state, TODAY)).toBe(2);
  });

  it("breaks on a missed day", () => {
    const state = ledger([["2026-03-04"], ["2026-03-02"], ["2026-03-01"]]);
    expect(dailyStreak(state, TODAY)).toBe(1);
  });

  it("ignores weekly-only keys so weekly games cannot inflate a daily streak", () => {
    const state = ledger([["2026-W10"], ["2026-03-04"]]);
    expect(dailyStreak(state, TODAY)).toBe(1);
  });
});

describe("shareText", () => {
  it("lists every game, marks played ones, and totals the day", () => {
    const state = actionsFor("2026-03-04", 10);
    const text = shareText(state, registry, TODAY);
    expect(text).toContain("Community Games 2026-03-04");
    expect(text.split("\n")).toHaveLength(registry.length + 2);
    expect(text).toContain("Total 50");
  });

  it("marks unplayed games without leaking any answer", () => {
    const text = shareText(ledger(), registry, TODAY);
    expect(text).toContain("not played");
    for (const leak of ["solution", "culprit", "outcome", "ops", "numbers"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("includes the streak only once it is worth bragging about", () => {
    const state = {
      actions: { "challenge:2026-03-04": { gameId: "challenge", periodKey: "2026-03-04", points: 10 } },
      history: ledger([["2026-03-04"], ["2026-03-03"]]).history,
      points: 10,
    };
    expect(shareText(state, registry, TODAY)).toContain("streak 2");

    const single = {
      actions: {},
      history: ledger([["2026-03-03"]]).history,
      points: 0,
    };
    expect(shareText(single, registry, TODAY)).not.toContain("streak");
  });
});