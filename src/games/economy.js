import { intBetween, rngFor } from "../engine/rng.js";

export const meta = {
  id: "economy",
  title: "Community Market",
  description: "Trade three goods through one volatile market day.",
  cadence: "daily",
  maxPoints: 20,
};

const GOODS = [
  { id: "grain", name: "Grain" },
  { id: "timber", name: "Timber" },
  { id: "ore", name: "Ore" },
];

const TRENDS = ["busy", "steady", "quiet"];
const STARTING_COINS = 30;
// Capacity is how many units you can HOLD at once, not how many you may trade.
// Counting both legs made the best possible day worth only 8 points out of 40.
const CAPACITY = 5;
// Best case is CAPACITY units at the largest spread, which is 4 coins a unit.
const MAX_POINTS = CAPACITY * 4;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason) {
  return { accepted: false, points: 0, result: {}, reveal: {}, reason };
}

export function roundFor(periodKey) {
  const rng = rngFor(`economy:${periodKey}`);
  const goods = GOODS.map((good) => {
    const buy = intBetween(rng, 2, 6);
    const sell = buy + intBetween(rng, 1, 4);
    const trend = TRENDS[intBetween(rng, 0, TRENDS.length - 1)];
    return { id: good.id, name: good.name, buy, sell, trend };
  });
  return { goods, startingCoins: STARTING_COINS, capacity: CAPACITY };
}

function readLegs(list, priceOf, label) {
  // Both sides must be present and well-formed; a no-op is expressed as an empty array.
  if (list === undefined || list === null)
    return { legs: [], reason: `${label} must be an array` };
  if (!Array.isArray(list))
    return { legs: [], reason: `${label} must be an array` };
  const legs = [];
  for (const entry of list) {
    if (!isPlainObject(entry))
      return { legs: [], reason: `${label} entries must be objects` };
    const price = priceOf(entry.goodId);
    if (price === undefined)
      return { legs: [], reason: `unknown good: ${entry.goodId}` };
    const qty = Number(entry.qty);
    if (!Number.isInteger(qty) || qty < 0)
      return {
        legs: [],
        reason: `${label} qty must be a non-negative integer`,
      };
    legs.push({ goodId: entry.goodId, qty, price });
  }
  return { legs, reason: null };
}

function totalQty(legs) {
  return legs.reduce((sum, leg) => sum + leg.qty, 0);
}

export function submit(round, action) {
  if (!isPlainObject(round) || !Array.isArray(round.goods))
    return reject("invalid round");
  if (!isPlainObject(action)) return reject("action must be an object");

  const buyPrice = (goodId) =>
    round.goods.find((good) => good.id === goodId)?.buy;
  const sellPrice = (goodId) =>
    round.goods.find((good) => good.id === goodId)?.sell;

  const buys = readLegs(action.buy, buyPrice, "buy");
  if (buys.reason) return reject(buys.reason);
  const sells = readLegs(action.sell, sellPrice, "sell");
  if (sells.reason) return reject(sells.reason);

  const capacity = Number.isInteger(round.capacity) ? round.capacity : CAPACITY;
  const coins = Number.isInteger(round.startingCoins)
    ? round.startingCoins
    : STARTING_COINS;

  if (totalQty(buys.legs) > capacity)
    return reject(
      `cannot hold ${totalQty(buys.legs)} units, capacity is ${capacity}`,
    );

  const totalBuyCost = buys.legs.reduce(
    (sum, leg) => sum + leg.qty * leg.price,
    0,
  );
  if (totalBuyCost > coins)
    return reject(
      `total buy cost ${totalBuyCost} exceeds ${coins} starting coins`,
    );

  const boughtByGood = new Map();
  for (const leg of buys.legs)
    boughtByGood.set(leg.goodId, (boughtByGood.get(leg.goodId) ?? 0) + leg.qty);
  const soldByGood = new Map();
  for (const leg of sells.legs)
    soldByGood.set(leg.goodId, (soldByGood.get(leg.goodId) ?? 0) + leg.qty);
  for (const [goodId, qty] of soldByGood) {
    if (qty > (boughtByGood.get(goodId) ?? 0))
      return reject(`cannot sell ${qty} ${goodId} without buying it first`);
  }

  const totalSellRevenue = sells.legs.reduce(
    (sum, leg) => sum + leg.qty * leg.price,
    0,
  );
  const profit = totalSellRevenue - totalBuyCost;
  const points = Math.max(0, Math.min(MAX_POINTS, Math.round(profit)));
  const finalCoins = coins - totalBuyCost + totalSellRevenue;
  const trades = [
    ...buys.legs.map((leg) => ({ side: "buy", ...leg })),
    ...sells.legs.map((leg) => ({ side: "sell", ...leg })),
  ];

  return {
    accepted: true,
    points,
    result: { finalCoins, profit, trades, goods: round.goods },
    reveal: {
      profit,
      points,
      summary:
        profit > 0
          ? `You cleared ${profit} coins of profit and finished with ${finalCoins}.`
          : `You finished with ${finalCoins} coins and no profit.`,
    },
  };
}

// Optimal play, used by tests to prove the ceiling is actually reachable.
// Margins are linear and capacity is shared, so concentrating on the best
// affordable spread is optimal.
export function bestAction(round) {
  if (!isPlainObject(round) || !Array.isArray(round.goods))
    return { buy: [], sell: [] };
  const capacity = Number.isInteger(round.capacity) ? round.capacity : CAPACITY;
  const coins = Number.isInteger(round.startingCoins)
    ? round.startingCoins
    : STARTING_COINS;
  let best = { buy: [], sell: [], profit: 0 };
  for (const good of round.goods) {
    const margin = good.sell - good.buy;
    if (margin <= 0) continue;
    const qty = Math.min(capacity, Math.floor(coins / good.buy));
    const profit = qty * margin;
    if (profit > best.profit)
      best = {
        buy: [{ goodId: good.id, qty }],
        sell: [{ goodId: good.id, qty }],
        profit,
      };
  }
  return { buy: best.buy, sell: best.sell };
}
