import { describe, expect, it } from "vitest";
import { createLedger, keyFor } from "../src/engine/progress.js";
import { dailyStreak, playedDays, shareText } from "../src/engine/streak.js";
import { registry } from "../src/games/index.js";

const TODAY = new Date("2026-03-04T12:00:00Z");

function played(periodKey, gameId = "challenge", points = 10) {
  return {
    gameId,
    periodKey,
    guesses: [
      { label: "guess", state: "correct", at: `${periodKey}T00:00:00.000Z` },
    ],
    solved: true,
    finished: true,
    points,
  };
}

function historyLedger(entries) {
  return createLedger({ history: entries.map((row) => played(...row)) });
}

// One finished entry per registered game for a single day.
function dayLedger(periodKey, points = 10, finished = true) {
  const progress = {};
  for (const game of registry) {
    progress[keyFor(game.meta.id, periodKey)] = {
      gameId: game.meta.id,
      periodKey,
      guesses: [
        { label: "guess", state: "correct", at: `${periodKey}T00:00:00.000Z` },
      ],
      solved: finished,
      finished,
      points,
    };
  }
  return createLedger({ progress });
}

describe("playedDays", () => {
  it("collects unique UTC days and ignores junk keys", () => {
    const days = playedDays(
      historyLedger([["2026-03-01"], ["2026-03-01"], ["2026-W10"], ["nope"]]),
    );
    expect([...days]).toEqual(["2026-03-01"]);
  });

  it("tolerates an empty or missing ledger", () => {
    expect(playedDays(historyLedger([])).size).toBe(0);
    expect(playedDays(undefined).size).toBe(0);
    expect(playedDays({}).size).toBe(0);
  });
});

describe("dailyStreak", () => {
  it("is zero with no history", () => {
    expect(dailyStreak(historyLedger([]), TODAY)).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const state = historyLedger([
      ["2026-03-04"],
      ["2026-03-03"],
      ["2026-03-02"],
    ]);
    expect(dailyStreak(state, TODAY)).toBe(3);
  });

  it("still shows yesterday's streak before today is played", () => {
    expect(
      dailyStreak(historyLedger([["2026-03-03"], ["2026-03-02"]]), TODAY),
    ).toBe(2);
  });

  it("breaks on a missed day", () => {
    const state = historyLedger([
      ["2026-03-04"],
      ["2026-03-02"],
      ["2026-03-01"],
    ]);
    expect(dailyStreak(state, TODAY)).toBe(1);
  });

  it("ignores weekly-only keys so weekly games cannot inflate a daily streak", () => {
    expect(
      dailyStreak(historyLedger([["2026-W10"], ["2026-03-04"]]), TODAY),
    ).toBe(1);
  });

  it("counts a day once no matter how many games were played", () => {
    // The engine appends one history entry per finished game, all sharing the period key,
    // so a five-game day must still read as a single day of streak.
    const state = historyLedger(
      registry.map((game) => ["2026-03-04", game.meta.id, 10]),
    );
    expect(playedDays(state).size).toBe(1);
    expect(dailyStreak(state, TODAY)).toBe(1);
  });

  it("does not count progress that never finished, since the engine only writes history on finish", () => {
    expect(dailyStreak(dayLedger("2026-03-04"), TODAY)).toBe(0);
  });
});

describe("shareText", () => {
  it("lists every game, marks played ones, and totals the day", () => {
    const text = shareText(dayLedger("2026-03-04"), registry, TODAY);
    expect(text).toContain("Community Games 2026-03-04");
    expect(text.split("\n")).toHaveLength(registry.length + 2);
    expect(text).toContain("Total 50");
    expect(text).not.toContain("not played");
  });

  it("marks unplayed games without leaking any answer", () => {
    const text = shareText(createLedger(), registry, TODAY);
    expect(text).toContain("not played");
    expect(text).toContain("Total 0");
    for (const leak of ["solution", "culprit", "outcome", "ops", "numbers"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("treats an unfinished game as not played until the run is over", () => {
    const progress = {
      [keyFor("challenge", "2026-03-04")]: {
        gameId: "challenge",
        periodKey: "2026-03-04",
        guesses: [
          {
            label: "3 + 4 * 5 = 35",
            state: "wrong",
            at: "2026-03-04T00:00:00.000Z",
          },
        ],
        solved: false,
        finished: false,
        points: 0,
      },
    };
    const text = shareText(createLedger({ progress }), registry, TODAY);
    expect(text).toContain("Daily Numbers - not played");
    expect(text).toContain("Total 0");
  });

  it("totals only the games finished today, not the whole ledger", () => {
    const progress = {
      [keyFor("challenge", "2026-03-04")]: played(
        "2026-03-04",
        "challenge",
        100,
      ),
      // Yesterday's result must not inflate today's total.
      [keyFor("mystery", "2026-03-03")]: played("2026-03-03", "mystery", 100),
    };
    const text = shareText(createLedger({ progress }), registry, TODAY);
    expect(text).toContain("Total 100");
  });

  it("includes the streak only once it is worth bragging about", () => {
    const two = createLedger({
      progress: { [keyFor("challenge", "2026-03-04")]: played("2026-03-04") },
      history: [played("2026-03-04"), played("2026-03-03")],
    });
    expect(shareText(two, registry, TODAY)).toContain("streak 2");

    const one = createLedger({ history: [played("2026-03-03")] });
    expect(shareText(one, registry, TODAY)).not.toContain("streak");
  });
});
