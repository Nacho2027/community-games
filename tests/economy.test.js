import { describe, expect, it } from "vitest";
import {
  bestAction,
  bestProfit,
  judge,
  meta,
  roundFor,
} from "../src/games/economy.js";

function keys(count) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

// Independent oracle: enumerate every legal plan and keep the most profitable one.
// Written against the published prices only, so it does not reuse the module's own maths.
function bruteForceBest(round) {
  const { goods, capacity, startingCoins } = round;
  let best = 0;

  const buyOptions = [];
  const walk = (index, remaining, acc) => {
    if (index === goods.length) {
      buyOptions.push([...acc]);
      return;
    }
    for (let qty = 0; qty <= remaining; qty += 1) {
      acc.push(qty);
      walk(index + 1, remaining - qty, acc);
      acc.pop();
    }
  };
  walk(0, capacity, []);

  for (const buys of buyOptions) {
    const cost = buys.reduce((sum, qty, i) => sum + qty * goods[i].buy, 0);
    if (cost > startingCoins) continue;

    const sellOptions = [];
    const walkSells = (index, acc) => {
      if (index === goods.length) {
        sellOptions.push([...acc]);
        return;
      }
      for (let qty = 0; qty <= buys[index]; qty += 1) {
        acc.push(qty);
        walkSells(index + 1, acc);
        acc.pop();
      }
    };
    walkSells(0, []);

    for (const sells of sellOptions) {
      const revenue = sells.reduce(
        (sum, qty, i) => sum + qty * goods[i].sell,
        0,
      );
      best = Math.max(best, revenue - cost);
    }
  }

  return best;
}

const FORBIDDEN_KEYS = new Set([
  "answer",
  "best",
  "optimal",
  "profit",
  "solution",
  "shortfall",
  "target",
]);

function keysOf(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keysOf(child, found);
    }
  }
  return found;
}

const PERIOD = "2026-01-15";

describe("market round content", () => {
  it("is deterministic for a period key", () => {
    expect(roundFor("2026-07-09")).toEqual(roundFor("2026-07-09"));
  });

  it("varies across period keys", () => {
    const shapes = new Set(
      keys(30).map((key) => JSON.stringify(roundFor(key))),
    );
    expect(shapes.size).toBeGreaterThan(20);
  });

  it("publishes three priced goods and the trading limits", () => {
    for (const key of keys(40)) {
      const round = roundFor(key);
      expect(Object.keys(round).sort()).toEqual([
        "capacity",
        "goods",
        "startingCoins",
      ]);
      expect(round.goods).toHaveLength(3);
      expect(round.capacity).toBeGreaterThan(0);
      expect(round.startingCoins).toBeGreaterThan(0);
      for (const good of round.goods) {
        expect(good.name).toBeTruthy();
        expect(Number.isInteger(good.buy)).toBe(true);
        expect(Number.isInteger(good.sell)).toBe(true);
        expect(good.sell).toBeGreaterThan(good.buy);
        expect(good.buy).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("carries no answer field", () => {
    for (const key of keys(60)) {
      for (const field of keysOf(roundFor(key))) {
        expect(FORBIDDEN_KEYS.has(field), `${key} exposed "${field}"`).toBe(
          false,
        );
      }
    }
  });

  it("advertises a three attempt solve", () => {
    expect(meta.mode).toBe("solve");
    expect(meta.maxAttempts).toBe(3);
    expect(meta.maxPoints).toBe(100);
  });
});

describe("market optimality", () => {
  it("bestProfit matches an exhaustive search on every day", () => {
    // The target the player is scored against must genuinely be the maximum, otherwise
    // "optimal" is a lie and the feedback misleads them.
    for (const key of keys(150)) {
      const round = roundFor(key);
      expect(bestProfit(round), key).toBe(bruteForceBest(round));
    }
  });

  it("the advertised optimum is actually reachable", () => {
    for (const key of keys(150)) {
      const round = roundFor(key);
      const verdict = judge(round, bestAction(round), {
        attempt: 1,
        maxAttempts: 5,
      });
      expect(verdict.accepted, key).toBe(true);
      expect(verdict.reveal.profit, key).toBe(bestProfit(round));
      expect(verdict.correct, key).toBe(true);
    }
  });
});

describe("market judging", () => {
  it("reports an optimal plan as correct", () => {
    for (const key of keys(80)) {
      const round = roundFor(key);
      const verdict = judge(round, bestAction(round), {
        attempt: 1,
        maxAttempts: 3,
      });
      expect(verdict.accepted).toBe(true);
      expect(verdict.correct).toBe(true);
      expect(verdict.feedback.state).toBe("correct");
      expect(verdict.feedback.detail).toContain("best");
      expect(verdict.reveal.best).toBeGreaterThan(0);
    }
  });

  it("reports a suboptimal plan as wrong and says how far off it was", () => {
    for (const key of keys(80)) {
      const round = roundFor(key);
      const worst = [...round.goods].sort(
        (a, b) => a.sell - a.buy - (b.sell - b.buy),
      )[0];
      const verdict = judge(
        round,
        {
          buy: [{ goodId: worst.id, qty: 1 }],
          sell: [{ goodId: worst.id, qty: 1 }],
        },
        { attempt: 1, maxAttempts: 3 },
      );

      expect(verdict.accepted).toBe(true);
      expect(verdict.correct).toBe(false);
      expect(["wrong", "close"]).toContain(verdict.feedback.state);
      expect(verdict.reveal.shortfall).toBeGreaterThan(0);
      expect(verdict.feedback.detail).toContain("short of optimal");
    }
  });

  it("treats a no-op plan as legal but not correct", () => {
    const round = roundFor(PERIOD);
    const verdict = judge(
      round,
      { buy: [], sell: [] },
      { attempt: 1, maxAttempts: 3 },
    );
    expect(verdict.accepted).toBe(true);
    expect(verdict.correct).toBe(false);
    expect(verdict.reveal.profit).toBe(0);
    expect(verdict.feedback.label).toBe("no trades");
  });

  it("always returns a short, readable label", () => {
    for (const key of keys(60)) {
      const round = roundFor(key);
      const verdict = judge(round, bestAction(round), {
        attempt: 1,
        maxAttempts: 3,
      });
      expect(verdict.feedback.label.length).toBeGreaterThan(0);
      expect(verdict.feedback.label.length).toBeLessThanOrEqual(60);
      expect(verdict.feedback.label).not.toContain("undefined");
      expect(verdict.feedback.label).not.toContain("NaN");
    }
  });

  it("sets a close state just under the optimum", () => {
    // A plan worth 70% or more should read as close rather than wrong.
    const round = roundFor(PERIOD);
    const best = bestProfit(round);
    const close = judge(
      round,
      {
        buy: [{ goodId: "grain", qty: 4 }],
        sell: [{ goodId: "grain", qty: 4 }],
      },
      { attempt: 1, maxAttempts: 3 },
    );
    expect(close.accepted).toBe(true);
    const ratio = close.reveal.profit / best;
    if (ratio >= 0.7 && close.reveal.profit < best)
      expect(close.feedback.state).toBe("close");
  });
});

describe("market rule enforcement", () => {
  const round = roundFor(PERIOD);

  it("rejects holding more than capacity", () => {
    const verdict = judge(
      round,
      { buy: [{ goodId: "grain", qty: round.capacity + 1 }], sell: [] },
      { attempt: 1, maxAttempts: 3 },
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toContain(`${round.capacity}`);
  });

  it("rejects spending more than the starting coins", () => {
    const priciest = [...round.goods].sort((a, b) => b.buy - a.buy)[0];
    const affordable = Math.floor(round.startingCoins / priciest.buy);
    const verdict = judge(
      round,
      { buy: [{ goodId: priciest.id, qty: affordable + 2 }], sell: [] },
      { attempt: 1, maxAttempts: 3 },
    );
    expect(verdict.accepted).toBe(false);
  });

  it("rejects selling what was never bought", () => {
    const verdict = judge(
      round,
      { buy: [], sell: [{ goodId: "grain", qty: 1 }] },
      { attempt: 1, maxAttempts: 3 },
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toContain("without buying it first");
  });

  it("rejects unknown goods, bad quantities and missing lists", () => {
    const cases = [
      { buy: [{ goodId: "gold", qty: 1 }], sell: [] },
      { buy: [{ goodId: "grain", qty: -1 }], sell: [] },
      { buy: [{ goodId: "grain", qty: 1.5 }], sell: [] },
      { buy: [{ goodId: "grain", qty: "2" }], sell: [] },
      // Guards against Number() coercion: true would become 1 unit and null 0.
      { buy: [{ goodId: "grain", qty: true }], sell: [] },
      { buy: [{ goodId: "grain", qty: null }], sell: [] },
      { buy: [{ goodId: "grain", qty: [] }], sell: [] },
      { buy: [{ goodId: "grain", qty: NaN }], sell: [] },
      { buy: [null], sell: [] },
      { buy: "grain", sell: [] },
      { buy: [{ goodId: "grain", qty: 1 }] },
      { sell: [{ goodId: "grain", qty: 0 }] },
      {},
    ];
    for (const action of cases) {
      const verdict = judge(round, action, { attempt: 1, maxAttempts: 3 });
      expect(verdict.accepted, JSON.stringify(action)).toBe(false);
      expect(verdict.correct).toBe(false);
      expect(typeof verdict.reason).toBe("string");
      expect(verdict.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("market robustness", () => {
  it("never throws on junk input", () => {
    const junk = [undefined, null, {}, [], "grain", 42, true, NaN, () => {}];
    for (const round of junk) {
      for (const action of junk) {
        expect(() =>
          judge(round, action, { attempt: 1, maxAttempts: 3 }),
        ).not.toThrow();
        expect(
          judge(round, action, { attempt: 1, maxAttempts: 3 }).accepted,
        ).toBe(false);
      }
    }
  });

  it("survives a missing context", () => {
    const round = roundFor(PERIOD);
    expect(() => judge(round, bestAction(round))).not.toThrow();
    expect(judge(round, bestAction(round)).accepted).toBe(true);
  });

  it("does not mutate the round it is given", () => {
    const round = roundFor(PERIOD);
    const snapshot = JSON.stringify(round);
    judge(round, bestAction(round), { attempt: 1, maxAttempts: 3 });
    judge(round, { buy: [], sell: [] }, { attempt: 2, maxAttempts: 3 });
    expect(JSON.stringify(round)).toBe(snapshot);
  });

  it("returns a plain action object from bestAction", () => {
    for (const key of keys(40)) {
      const action = bestAction(roundFor(key));
      expect(Array.isArray(action.buy)).toBe(true);
      expect(Array.isArray(action.sell)).toBe(true);
      expect(Object.keys(action).sort()).toEqual(["buy", "sell"]);
    }
    expect(bestAction(undefined)).toEqual({ buy: [], sell: [] });
  });
});
