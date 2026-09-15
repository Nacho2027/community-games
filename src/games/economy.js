import { intBetween, rngFor } from "../engine/rng.js";

export const meta = {
  id: "economy",
  title: "Community Market",
  description:
    "Plan one day of trades to clear as much profit as the market allows.",
  cadence: "daily",
  mode: "solve",
  maxAttempts: 3,
  maxPoints: 100,
};

const GOODS = [
  { id: "grain", name: "Grain" },
  { id: "timber", name: "Timber" },
  { id: "ore", name: "Ore" },
];

const TRENDS = ["busy", "steady", "quiet"];
const STARTING_COINS = 30;
// Capacity is how many units you can HOLD at once, not how many you may trade.
const CAPACITY = 5;
const CLOSE_RATIO = 0.7;
const LABEL_LIMIT = 60;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason) {
  return { accepted: false, reason, correct: false, feedback: null };
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
  // Both sides must be present and well-formed; a no-op is an empty array.
  if (!Array.isArray(list))
    return { legs: [], reason: `${label} must be an array` };
  const legs = [];
  for (const entry of list) {
    if (!isPlainObject(entry))
      return { legs: [], reason: `${label} entries must be objects` };
    const price = priceOf(entry.goodId);
    if (price === undefined)
      return { legs: [], reason: `There is no good called "${entry.goodId}".` };
    // Strict integer, deliberately not Number(): coercion would accept `true` as 1 unit
    // and `null` as 0, which are exactly the kind of silent surprises a trading rule
    // should reject outright.
    if (!Number.isInteger(entry.qty) || entry.qty < 0)
      return { legs: [], reason: `${label} quantities must be whole numbers.` };
    legs.push({ goodId: entry.goodId, qty: entry.qty, price });
  }
  return { legs, reason: null };
}

function totalQty(legs) {
  return legs.reduce((sum, leg) => sum + leg.qty, 0);
}

// Short readable summary for the guess history in the UI.
function describeLegs(buys, sells, goods) {
  const nameOf = (id) =>
    (goods.find((good) => good.id === id)?.name ?? id).toLowerCase();
  const parts = [];
  for (const leg of buys)
    if (leg.qty > 0) parts.push(`buy ${leg.qty} ${nameOf(leg.goodId)}`);
  for (const leg of sells)
    if (leg.qty > 0) parts.push(`sell ${leg.qty} ${nameOf(leg.goodId)}`);
  if (parts.length === 0) return "no trades";

  const label = parts.join(", ");
  if (label.length <= LABEL_LIMIT) return label;
  return `${totalQty(buys)} bought, ${totalQty(sells)} sold`;
}

// Optimal play, and the target the player is scored against.
// Margins are linear and capacity is shared, so concentrating the whole position on the
// best affordable spread is optimal.
export function bestAction(round) {
  if (!isPlainObject(round) || !Array.isArray(round.goods))
    return { buy: [], sell: [] };
  const capacity = Number.isInteger(round.capacity) ? round.capacity : CAPACITY;
  const coins = Number.isInteger(round.startingCoins)
    ? round.startingCoins
    : STARTING_COINS;

  let best = { action: { buy: [], sell: [] }, profit: 0 };
  for (const good of round.goods) {
    const margin = good.sell - good.buy;
    if (margin <= 0) continue;
    const qty = Math.min(capacity, Math.floor(coins / good.buy));
    if (qty <= 0) continue;
    const profit = qty * margin;
    if (profit > best.profit)
      best = {
        action: {
          buy: [{ goodId: good.id, qty }],
          sell: [{ goodId: good.id, qty }],
        },
        profit,
      };
  }
  return best.action;
}

export function bestProfit(round) {
  const action = bestAction(round);
  const buys = action.buy ?? [];
  const profit = (action.sell ?? []).reduce((sum, leg) => {
    const good = round.goods.find((item) => item.id === leg.goodId);
    const cost = buys.find((item) => item.goodId === leg.goodId);
    if (!good || !cost) return sum;
    return sum + leg.qty * (good.sell - good.buy);
  }, 0);
  return profit;
}

// Judge a single trading day. The player is not guessing at a hidden answer: the target is
// how much profit the market actually allows, so the feedback can say exactly how far off
// they were and what to do about it.
export function judge(round, action, context) {
  try {
    if (!isPlainObject(round) || !Array.isArray(round.goods))
      return reject("The market data is unavailable.");
    if (!isPlainObject(action)) return reject("Send buy and sell lists.");

    const buyPrice = (goodId) =>
      round.goods.find((good) => good.id === goodId)?.buy;
    const sellPrice = (goodId) =>
      round.goods.find((good) => good.id === goodId)?.sell;

    const buys = readLegs(action.buy, buyPrice, "Buy");
    if (buys.reason) return reject(buys.reason);
    const sells = readLegs(action.sell, sellPrice, "Sell");
    if (sells.reason) return reject(sells.reason);

    const capacity = Number.isInteger(round.capacity)
      ? round.capacity
      : CAPACITY;
    const coins = Number.isInteger(round.startingCoins)
      ? round.startingCoins
      : STARTING_COINS;

    const held = totalQty(buys.legs);
    if (held > capacity)
      return reject(
        `You can only hold ${capacity} units, and that plan holds ${held}.`,
      );

    const buyCost = buys.legs.reduce(
      (sum, leg) => sum + leg.qty * leg.price,
      0,
    );
    if (buyCost > coins)
      return reject(
        `That plan costs ${buyCost} coins and you only have ${coins}.`,
      );

    const boughtByGood = new Map();
    for (const leg of buys.legs)
      boughtByGood.set(
        leg.goodId,
        (boughtByGood.get(leg.goodId) ?? 0) + leg.qty,
      );

    for (const leg of sells.legs) {
      const available = boughtByGood.get(leg.goodId) ?? 0;
      if (leg.qty > available)
        return reject(
          `You cannot sell ${leg.qty} ${leg.goodId} without buying it first.`,
        );
    }

    const sellRevenue = sells.legs.reduce(
      (sum, leg) => sum + leg.qty * leg.price,
      0,
    );
    const profit = sellRevenue - buyCost;
    const best = bestProfit(round);
    const correct = profit === best && best > 0;
    const shortfall = best - profit;

    const state = correct
      ? "correct"
      : profit >= best * CLOSE_RATIO
        ? "close"
        : "wrong";
    const detail =
      best > 0
        ? correct
          ? `You cleared ${profit} coins. That is the best this market allows.`
          : `You cleared ${profit}. The best plan clears ${best}: ${shortfall} short of optimal.`
        : `You cleared ${profit} coins.`;

    return {
      accepted: true,
      correct,
      feedback: {
        label: describeLegs(buys.legs, sells.legs, round.goods),
        state,
        detail,
      },
      reveal: {
        profit,
        best,
        shortfall,
        finalCoins: coins - buyCost + sellRevenue,
        trades: [
          ...buys.legs.map((leg) => ({ side: "buy", ...leg })),
          ...sells.legs.map((leg) => ({ side: "sell", ...leg })),
        ],
        attempt: context?.attempt ?? 1,
      },
    };
  } catch {
    return reject("That plan could not be read.");
  }
}
