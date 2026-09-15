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

describe("economy scoring scale", () => {
  function keys(count) {
    const start = Date.UTC(2026, 0, 1);
    return Array.from({ length: count }, (_, index) =>
      new Date(start + index * 86400000).toISOString().slice(0, 10),
    );
  }

  it("a perfect day is worth exactly maxPoints", () => {
    // Regression: capacity used to count buy and sell legs together, so the best
    // possible day scored 8 against an advertised ceiling of 40.
    const perfect = keys(120).filter((key) => {
      const round = roundFor(key);
      return submit(round, bestAction(round).action).points === meta.maxPoints;
    });
    expect(perfect.length).toBeGreaterThan(0);
  });

  it("never awards more than the advertised ceiling", () => {
    for (const key of keys(120)) {
      const round = roundFor(key);
      const verdict = submit(round, bestAction(round).action);
      expect(verdict.points).toBeLessThanOrEqual(meta.maxPoints);
    }
  });

  it("always leaves a profitable trade available", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      expect(submit(round, bestAction(round).action).points).toBeGreaterThan(0);
    }
  });

  it("counts capacity as units held, so round-tripping a position is legal", () => {
    const round = roundFor(PERIOD);
    const action = bestAction(round).action;
    const buyQty = action.buy.reduce((sum, leg) => sum + leg.qty, 0);
    const sellQty = action.sell.reduce((sum, leg) => sum + leg.qty, 0);

    // Buying and selling the same position trades twice the capacity in volume.
    expect(buyQty + sellQty).toBeGreaterThan(round.capacity);
    expect(submit(round, action).accepted).toBe(true);
  });

  it("still refuses to hold more units than capacity", () => {
    const round = roundFor(PERIOD);
    const cheapest = [...round.goods].sort((a, b) => a.buy - b.buy)[0];
    const verdict = submit(round, {
      buy: [{ goodId: cheapest.id, qty: round.capacity + 1 }],
      sell: [],
    });
    expect(verdict.accepted).toBe(false);
  });

  it("still refuses to sell what was not bought", () => {
    const round = roundFor(PERIOD);
    const verdict = submit(round, {
      buy: [],
      sell: [{ goodId: round.goods[0].id, qty: 1 }],
    });
    expect(verdict.accepted).toBe(false);
  });
});
