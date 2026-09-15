import { describe, expect, it } from "vitest";
import { createApi } from "../src/server/api.js";
import * as challenge from "../src/games/challenge.js";
import { registry } from "../src/games/index.js";

const AT = new Date("2026-03-04T12:00:00Z");

function harness({ authenticated = true, storage = new Map() } = {}) {
  const api = createApi({
    identify: async () => {
      if (!authenticated) throw new Error("no session");
      return { id: "u1", name: "ada" };
    },
    loadLedger: async (player) => storage.get(player.name) ?? undefined,
    saveLedger: async (player, ledger) => storage.set(player.name, ledger),
    now: () => AT,
  });
  return { api, storage };
}

function solution() {
  return challenge.solve(challenge.roundFor("2026-03-04"));
}

describe("server api", () => {
  it("requires a factory contract", () => {
    expect(() => createApi({})).toThrow();
    expect(() => createApi({ identify: () => ({ name: "x" }) })).toThrow();
  });

  it("rejects unauthenticated callers", async () => {
    const { api } = harness({ authenticated: false });
    expect((await api.state()).status).toBe(401);
    expect((await api.play({ gameId: "challenge", action: {} })).status).toBe(
      401,
    );
  });

  it("returns the player and their progress", async () => {
    const { api } = harness();
    const result = await api.state();
    expect(result.status).toBe(200);
    expect(result.body.player.name).toBe("ada");
    expect(result.body.ledger.points).toBe(0);
  });

  it("serves every registered game's round", async () => {
    const { api } = harness();
    for (const game of registry) {
      const result = await api.round({ gameId: game.meta.id });
      expect(result.status, game.meta.id).toBe(200);
      expect(result.body.periodKey).toBe("2026-03-04");
      expect(result.body.played).toBe(false);
      expect(result.body.round).toBeTruthy();
    }
  });

  it("404s an unknown game and lists the valid ids", async () => {
    const { api } = harness();
    const result = await api.round({ gameId: "nope" });
    expect(result.status).toBe(404);
    expect(result.body.games).toHaveLength(5);
  });

  it("awards points for a valid action and persists them", async () => {
    const { api, storage } = harness();
    const result = await api.play({ gameId: "challenge", action: solution() });
    expect(result.status).toBe(200);
    expect(result.body.accepted).toBe(true);
    expect(result.body.points).toBe(10);
    expect(storage.get("ada").points).toBe(10);
  });

  it("refuses a duplicate attempt without awarding points again", async () => {
    const { api, storage } = harness();
    await api.play({ gameId: "challenge", action: solution() });
    const again = await api.play({ gameId: "challenge", action: solution() });
    expect(again.body.accepted).toBe(false);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.points).toBe(0);
    expect(storage.get("ada").points).toBe(10);
    expect(storage.get("ada").history).toHaveLength(1);
  });

  it("does not consume the day for a malformed action", async () => {
    const { api } = harness();
    const bad = await api.play({ gameId: "challenge", action: { nope: 1 } });
    expect(bad.body.accepted).toBe(false);

    const good = await api.play({ gameId: "challenge", action: solution() });
    expect(good.body.accepted).toBe(true);
    expect(good.body.points).toBe(10);
  });

  it("never leaks the answer through the round endpoint", async () => {
    const { api } = harness();
    const result = await api.round({ gameId: "challenge" });
    expect(JSON.stringify(result.body.round)).not.toContain("ops");
    expect(JSON.stringify(result.body.round)).not.toContain("solution");
  });

  it("keeps separate progress per player", async () => {
    const storage = new Map();
    const first = harness({ storage });
    await first.api.play({ gameId: "challenge", action: solution() });

    const second = createApi({
      identify: async () => ({ id: "u2", name: "grace" }),
      loadLedger: async (player) => storage.get(player.name) ?? undefined,
      saveLedger: async (player, ledger) => storage.set(player.name, ledger),
      now: () => AT,
    });
    const state = await second.state();
    expect(state.body.player.name).toBe("grace");
    expect(state.body.ledger.points).toBe(0);
  });
});
