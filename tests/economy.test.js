import { describe, expect, it } from "vitest";
import { meta, roundFor, submit } from "../src/games/economy.js";

const PERIOD = "2026-01-15";

// Brute force every legal single-good trade to prove a profitable action exists.
function bestAction(round) {
  let best = {
    action: { buy: [], sell: [] },
    profit: Number.NEGATIVE_INFINITY,
  };
  for (const good of round.goods) {
    for (let qty = 1; qty <= round.capacity; qty += 1) {
      if (qty * good.buy > round.startingCoins) continue;
      const action = {
        buy: [{ goodId: good.id, qty }],
        sell: [{ goodId: good.id, qty }],
      };
      const outcome = submit(round, action);
      if (outcome.accepted && outcome.reveal.profit > best.profit) {
        best = { action, profit: outcome.reveal.profit };
      }
    }
  }
  return best;
}

describe("economy round content", () => {
  it("is deterministic for the same periodKey", () => {
    expect(roundFor(PERIOD)).toEqual(roundFor(PERIOD));
    expect(roundFor(PERIOD)).not.toEqual(roundFor("2026-01-16"));
  });

  it("publishes three goods with sell above buy and no hidden answers", () => {
    const round = roundFor(PERIOD);
    expect(round.goods).toHaveLength(3);
    expect(round.startingCoins).toBe(30);
    expect(round.capacity).toBe(5);
    for (const good of round.goods) {
      expect(good.sell).toBeGreaterThan(good.buy);
      expect(["busy", "steady", "quiet"]).toContain(good.trend);
    }
    const serialized = JSON.stringify(round);
    expect(serialized).not.toContain("profit");
    expect(serialized).not.toContain("points");
  });

  it("always contains a profitable action, proven by brute force", () => {
    for (const period of [
      "2026-01-15",
      "2026-02-01",
      "2026-03-09",
      "2026-12-31",
    ]) {
      const round = roundFor(period);
      const best = bestAction(round);
      expect(best.profit).toBeGreaterThan(0);
      const outcome = submit(round, best.action);
      expect(outcome.accepted).toBe(true);
      expect(outcome.points).toBeGreaterThan(0);
      expect(outcome.points).toBeLessThanOrEqual(meta.maxPoints);
    }
  });
});

describe("economy validation", () => {
  it("rejects malformed actions without throwing", () => {
    const round = roundFor(PERIOD);
    const malformed = [
      undefined,
      null,
      "trade",
      42,
      [],
      { buy: "grain" },
      { buy: [{ goodId: "unobtainium", qty: 1 }] },
      { buy: [{ goodId: "grain", qty: -1 }] },
      { buy: [{ goodId: "grain", qty: 1.5 }] },
      {
        buy: [
          { goodId: "grain", qty: 5 },
          { goodId: "ore", qty: 5 },
        ],
      },
      { sell: [{ goodId: "grain", qty: 1 }] },
    ];
    for (const action of malformed) {
      const outcome = submit(round, action);
      expect(outcome.accepted).toBe(false);
      expect(outcome.points).toBe(0);
      expect(typeof outcome.reason).toBe("string");
    }
  });

  it("rejects a round that is not a market", () => {
    expect(submit(null, { buy: [], sell: [] }).accepted).toBe(false);
    expect(submit({ goods: "nope" }, { buy: [], sell: [] }).accepted).toBe(
      false,
    );
  });

  it("caps spend at starting coins and caps points at maxPoints", () => {
    const round = roundFor(PERIOD);
    const expensive = round.goods.map((good) => ({ goodId: good.id, qty: 3 }));
    const cost = expensive.reduce((sum, leg) => {
      const good = round.goods.find((item) => item.id === leg.goodId);
      return sum + leg.qty * good.buy;
    }, 0);
    if (cost > round.startingCoins) {
      expect(submit(round, { buy: expensive, sell: [] }).accepted).toBe(false);
    }
    const idling = submit(round, { buy: [], sell: [] });
    expect(idling.accepted).toBe(true);
    expect(idling.points).toBe(0);
    expect(idling.result.finalCoins).toBe(round.startingCoins);
  });
});
