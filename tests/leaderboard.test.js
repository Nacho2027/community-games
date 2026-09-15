import { describe, expect, it } from "vitest";
import * as challenge from "../src/games/challenge.js";
import * as prediction from "../src/games/prediction.js";
import { periodFor, registry } from "../src/games/index.js";
import { createApi, rankScores } from "../src/server/api.js";

// Each game keeps its own daily board. These tests cover the two halves separately: the
// pure ranking rule, and the endpoint that turns a host's rows into a board.

const AT = new Date("2026-03-04T12:00:00Z");
const DAY = "2026-03-04";

function row(over = {}) {
  return {
    playerId: "p1",
    name: "Ada",
    points: 50,
    attemptsUsed: 2,
    solved: true,
    at: "2026-03-04T10:00:00.000Z",
    ...over,
  };
}

describe("rankScores", () => {
  it("puts more points first", () => {
    const ranked = rankScores([row({ name: "low", points: 10 }), row({ name: "high", points: 90 })]);
    expect(ranked.map((entry) => entry.name)).toEqual(["high", "low"]);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it("breaks a points tie with fewer attempts", () => {
    const ranked = rankScores([
      row({ name: "slow", points: 80, attemptsUsed: 4 }),
      row({ name: "quick", points: 80, attemptsUsed: 1 }),
    ]);
    expect(ranked.map((entry) => entry.name)).toEqual(["quick", "slow"]);
  });

  it("breaks a points and attempts tie with whoever got there first", () => {
    const ranked = rankScores([
      row({ name: "late", at: "2026-03-04T18:00:00.000Z" }),
      row({ name: "early", at: "2026-03-04T08:00:00.000Z" }),
    ]);
    expect(ranked.map((entry) => entry.name)).toEqual(["early", "late"]);
  });

  it("is deterministic when everything ties", () => {
    const rows = [row({ name: "Zoe" }), row({ name: "Ada" })];
    expect(rankScores(rows).map((entry) => entry.name)).toEqual(rankScores([...rows].reverse()).map((entry) => entry.name));
    expect(rankScores(rows).map((entry) => entry.name)).toEqual(["Ada", "Zoe"]);
  });

  it("applies a limit", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row({ playerId: `p${index}`, name: `p${index}`, points: index }),
    );
    expect(rankScores(rows, 3)).toHaveLength(3);
    expect(rankScores(rows, 3).map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it("never trusts a host's stored rows", () => {
    const ranked = rankScores([
      // No name or no id: unrankable, so dropped rather than shown as a blank row.
      row({ name: "", playerId: "x" }),
      row({ name: "ok", playerId: "" }),
      null,
      "nonsense",
      // Out-of-range numbers are coerced, not passed through.
      row({ name: "hostile", points: -500, attemptsUsed: "9", solved: "yes" }),
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe("hostile");
    expect(ranked[0].points).toBe(0);
    expect(ranked[0].attemptsUsed).toBe(9);
    expect(ranked[0].solved).toBe(false);
  });

  it("returns nothing for a non-list", () => {
    expect(rankScores(undefined)).toEqual([]);
    expect(rankScores("nope")).toEqual([]);
  });
});

function harness({ withBoard = true, rows = [], rank = null, stats = null, player = { id: "u1", name: "ada" } } = {}) {
  const ledgers = new Map();
  const recorded = [];
  const asked = [];

  const api = createApi({
    identify: async () => player,
    loadLedger: async (who) => ledgers.get(who.name),
    saveLedger: async (who, ledger) => {
      ledgers.set(who.name, ledger);
    },
    now: () => AT,
    ...(withBoard
      ? {
          recordScore: async (entry) => {
            recorded.push(entry);
          },
          topScores: async (query) => {
            asked.push(query);
            return rows;
          },
          playerRank: async () => rank,
          boardStats: async () => stats,
        }
      : {}),
  });

  return { api, recorded, asked };
}

function sensorAction() {
  const solved = challenge.solve(challenge.roundFor(DAY));
  if (!solved) throw new Error("the fixed day is unsolvable");
  return solved;
}

describe("leaderboard endpoint", () => {
  it("rejects an unknown game", async () => {
    const { api } = harness();
    const response = await api.leaderboard({ gameId: "nope" });
    expect(response.status).toBe(404);
    expect(response.body.games).toEqual(registry.map((game) => game.meta.id));
  });

  it("requires a player", async () => {
    const api = createApi({
      identify: async () => {
        throw new Error("no session");
      },
      loadLedger: async () => undefined,
      saveLedger: async () => {},
      topScores: async () => [],
    });
    expect((await api.leaderboard({ gameId: "challenge" })).status).toBe(401);
  });

  it("says so plainly when the host has no board", async () => {
    const { api } = harness({ withBoard: false });
    const response = await api.leaderboard({ gameId: "challenge" });
    expect(response.status).toBe(200);
    expect(response.body.available).toBe(false);
    expect(response.body.entries).toEqual([]);
    expect(response.body.you).toBeNull();
  });

  it("asks the host for the requested game's own period", async () => {
    // Boards are per game, so the host must be asked per game, not once globally.
    const { api, asked } = harness();
    await api.leaderboard({ gameId: "economy" });

    expect(asked).toHaveLength(1);
    expect(asked[0].gameId).toBe("economy");
    expect(asked[0].periodKey).toBe(periodFor(registry.find((game) => game.meta.id === "economy"), AT));
  });

  it("ranks the host's rows and marks your own", async () => {
    const { api } = harness({
      rows: [
        row({ playerId: "u2", name: "Zed", points: 10 }),
        row({ playerId: "u1", name: "ada", points: 90, attemptsUsed: 1 }),
      ],
      stats: { played: 40, solved: 31, firstTry: 9 },
    });

    const { body } = await api.leaderboard({ gameId: "challenge" });
    expect(body.available).toBe(true);
    expect(body.entries.map((entry) => entry.name)).toEqual(["ada", "Zed"]);
    expect(body.entries[0].rank).toBe(1);
    expect(body.you.playerId).toBe("u1");
    expect(body.stats).toEqual({ played: 40, solved: 31, firstTry: 9 });
  });

  it("asks for your rank when you are outside the top", async () => {
    const { api } = harness({
      rows: [row({ playerId: "u2", name: "Zed", points: 99 })],
      rank: 47,
      stats: { played: 90, solved: 40, firstTry: 3 },
    });

    const { body } = await api.leaderboard({ gameId: "challenge" });
    expect(body.you.rank).toBe(47);
    expect(body.entries).toHaveLength(1);
  });

  it("never reports more solves than players", async () => {
    const { api } = harness({ stats: { played: 10, solved: 999, firstTry: 999 } });
    const { body } = await api.leaderboard({ gameId: "challenge" });
    expect(body.stats.solved).toBe(10);
    expect(body.stats.firstTry).toBe(10);
  });
});

describe("recording a score", () => {
  it("records once when a period finishes", async () => {
    const { api, recorded } = harness();
    const response = await api.play({ gameId: "challenge", action: sensorAction() });

    expect(response.body.accepted).toBe(true);
    expect(response.body.finished).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].gameId).toBe("challenge");
    expect(recorded[0].periodKey).toBe(DAY);
    expect(recorded[0].player).toEqual({ id: "u1", name: "ada" });
    expect(recorded[0].points).toBe(challenge.meta.maxPoints);
    expect(recorded[0].attemptsUsed).toBe(1);
    expect(recorded[0].solved).toBe(true);
  });

  it("does not record a second time for a replayed period", async () => {
    // The engine refuses to reopen a finished period, so a score can never be double-counted.
    const { api, recorded } = harness();
    await api.play({ gameId: "challenge", action: sensorAction() });
    const replay = await api.play({ gameId: "challenge", action: sensorAction() });

    expect(replay.body.accepted).toBe(false);
    expect(replay.body.duplicate).toBe(true);
    expect(recorded).toHaveLength(1);
  });

  it("does not record an unfinished period", async () => {
    const { api, recorded } = harness();
    // Prediction is a series: one call out of three leaves the period open.
    const round = prediction.roundFor(DAY);
    const outcome = prediction.outcomeFor(DAY, round.questions[0].templateId);
    const response = await api.play({ gameId: "prediction", action: { pick: outcome, confidence: 100 } });

    expect(response.body.accepted).toBe(true);
    expect(response.body.finished).toBe(false);
    expect(recorded).toHaveLength(0);
  });

  it("does not record a refused move", async () => {
    const { api, recorded } = harness();
    const response = await api.play({ gameId: "challenge", action: { numbers: [1], ops: [] } });

    expect(response.body.accepted).toBe(false);
    expect(recorded).toHaveLength(0);
  });
});