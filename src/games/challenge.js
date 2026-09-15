import { intBetween, rngFor, shuffle } from "../engine/rng.js";

export const meta = {
  id: "challenge",
  title: "Daily Numbers",
  description:
    "Combine exactly three numbers from today's pool to hit the target.",
  cadence: "daily",
  maxPoints: 10,
};

const OPS = ["+", "-", "*"];
const POOL_SIZE = 6;
const POOL_MIN = 2;
const POOL_MAX = 25;
const ATTEMPTS = 50;

// Strict left-to-right evaluation: ((n1 op1 n2) op2 n3). Never operator precedence.
function evaluate(numbers, ops) {
  let total = numbers[0];
  for (let index = 0; index < ops.length; index += 1) {
    const operand = numbers[index + 1];
    if (ops[index] === "+") total += operand;
    else if (ops[index] === "-") total -= operand;
    else total *= operand;
  }
  return total;
}

function makePool(rng) {
  const pool = [];
  while (pool.length < POOL_SIZE) {
    const candidate = intBetween(rng, POOL_MIN, POOL_MAX);
    if (!pool.includes(candidate)) pool.push(candidate);
  }
  return pool;
}

// Builds a round that is solvable by construction: the target is derived from a
// real three-number expression, so a solution always exists.
function build(seed) {
  const rng = rngFor(seed);
  const pool = makePool(rng);
  const order = shuffle(
    rng,
    pool.map((_, index) => index),
  );
  const numbers = order.slice(0, 3).map((index) => pool[index]);
  const ops = [
    OPS[Math.floor(rng() * OPS.length)],
    OPS[Math.floor(rng() * OPS.length)],
  ];
  return { pool, numbers, ops, target: evaluate(numbers, ops) };
}

// Deterministic last resort. Summing the three largest values is always a legal
// expression, and the sum is strictly greater than the largest pool value, so the
// target is never a single pool value.
function fallback(pool) {
  const largest = [...pool].sort((a, b) => b - a).slice(0, 3);
  return { pool, target: largest.reduce((sum, value) => sum + value, 0) };
}

export function roundFor(periodKey) {
  const key = String(periodKey);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const round = build(`challenge:${key}:${attempt}`);
    if (round.target > 0 && !round.pool.includes(round.target))
      return { periodKey: key, pool: round.pool, target: round.target };
  }
  return {
    periodKey: key,
    ...fallback(makePool(rngFor(`challenge:${key}:0`))),
  };
}

// Brute force over ordered pool triples and every operator pair. Used by tests to
// prove each generated round is solvable.
export function solve(round) {
  const pool = Array.isArray(round?.pool) ? round.pool : null;
  const target = round?.target;
  if (!pool || pool.length < 3 || !Number.isInteger(target)) return null;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = 0; j < pool.length; j += 1) {
      if (j === i) continue;
      for (let k = 0; k < pool.length; k += 1) {
        if (k === i || k === j) continue;
        const numbers = [pool[i], pool[j], pool[k]];
        for (const first of OPS) {
          for (const second of OPS) {
            const ops = [first, second];
            if (evaluate(numbers, ops) === target) return { numbers, ops };
          }
        }
      }
    }
  }
  return null;
}

function reject(reason) {
  return { accepted: false, points: 0, result: {}, reveal: { reason }, reason };
}

function multiplicity(list) {
  const counts = new Map();
  for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function submit(round, action) {
  try {
    const pool = Array.isArray(round?.pool) ? round.pool : null;
    const target = round?.target;
    if (!pool || !Number.isInteger(target)) return reject("invalid-round");
    if (!action || typeof action !== "object")
      return reject("malformed-action");

    const { numbers, ops } = action;
    if (!Array.isArray(numbers) || numbers.length !== 3)
      return reject("numbers");
    if (!Array.isArray(ops) || ops.length !== 2) return reject("ops");
    if (!numbers.every((value) => Number.isInteger(value)))
      return reject("numbers");
    if (!ops.every((value) => OPS.includes(value))) return reject("ops");

    const available = multiplicity(pool);
    for (const value of numbers) {
      const left = available.get(value) ?? 0;
      if (left <= 0) return reject("not-in-pool");
      available.set(value, left - 1);
    }

    const computed = evaluate(numbers, ops);
    if (computed !== target)
      return {
        // A well-formed but wrong answer still consumes today's attempt: without this,
        // the ledger would let a player brute-force the target by resubmitting.
        accepted: true,
        points: 0,
        result: { computed, target },
        reveal: { computed, target, solved: false },
      };

    return {
      accepted: true,
      points: meta.maxPoints,
      result: { computed, target },
      reveal: { computed, target, solved: true },
    };
  } catch {
    return reject("exception");
  }
}
