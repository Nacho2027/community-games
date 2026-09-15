import { intBetween, rngFor, shuffle } from "../engine/rng.js";

export const meta = {
  id: "challenge",
  title: "Daily Numbers",
  description:
    "Combine three numbers from the pool with two operators to hit the target.",
  cadence: "daily",
  mode: "solve",
  maxAttempts: 6,
  maxPoints: 100,
};

const OPS = ["+", "-", "*"];
const POOL_SIZE = 6;
const POOL_MIN = 2;
const POOL_MAX = 25;
const ATTEMPTS = 50;
const CLOSE_ENOUGH = 5;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason) {
  return { accepted: false, reason, correct: false, feedback: null };
}

// Strict left-to-right evaluation. No operator precedence: the player sees exactly what
// they typed, so the feedback is never surprising.
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

function compose(seed) {
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

function fallback(pool) {
  const largest = [...pool].sort((a, b) => b - a).slice(0, 3);
  return { pool, target: largest.reduce((sum, value) => sum + value, 0) };
}

export function roundFor(periodKey) {
  const key = String(periodKey);
  // Reject degenerate targets: a target equal to a pool value, or one that is not
  // positive, makes the puzzle trivially solvable or confusing to read.
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const round = compose(`challenge:${key}:${attempt}`);
    if (round.target > 0 && !round.pool.includes(round.target))
      return { periodKey: key, pool: round.pool, target: round.target };
  }
  return {
    periodKey: key,
    ...fallback(makePool(rngFor(`challenge:${key}:0`))),
  };
}

// Brute force every ordered triple of pool values against every operator pair.
export function solve(round) {
  const pool = Array.isArray(round?.pool) ? round.pool : null;
  const target = round?.target;
  if (!pool || pool.length < 3 || !Number.isInteger(target)) return null;

  for (let i = 0; i < pool.length; i += 1)
    for (let j = 0; j < pool.length; j += 1) {
      if (j === i) continue;
      for (let k = 0; k < pool.length; k += 1) {
        if (k === i || k === j) continue;
        const numbers = [pool[i], pool[j], pool[k]];
        for (const first of OPS)
          for (const second of OPS) {
            const ops = [first, second];
            if (evaluate(numbers, ops) === target) return { numbers, ops };
          }
      }
    }
  return null;
}

function multiplicity(list) {
  const counts = new Map();
  for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function describe(numbers, ops, total) {
  return `${numbers[0]} ${ops[0]} ${numbers[1]} ${ops[1]} ${numbers[2]} = ${total}`;
}

// Judge a single guess. Returns the running total and which way it missed, which is the
// signal a player actually learns from between attempts.
export function judge(round, action) {
  const pool = Array.isArray(round?.pool) ? round.pool : null;
  const target = round?.target;
  if (!pool || !Number.isInteger(target)) return reject("invalid-round");
  if (!isPlainObject(action))
    return reject("Pick three numbers and two operators.");

  const { numbers, ops } = action;
  if (!Array.isArray(numbers) || numbers.length !== 3)
    return reject("Choose exactly three numbers.");
  if (!Array.isArray(ops) || ops.length !== 2)
    return reject("Choose exactly two operators.");
  if (!numbers.every((value) => Number.isInteger(value)))
    return reject("Choose exactly three numbers.");
  if (!ops.every((value) => OPS.includes(value)))
    return reject("Operators must be + - or *.");

  const available = multiplicity(pool);
  for (const value of numbers) {
    const left = available.get(value) ?? 0;
    if (left <= 0) return reject("You can only use numbers from the pool.");
    available.set(value, left - 1);
  }

  const computed = evaluate(numbers, ops);
  const correct = computed === target;
  const delta = target - computed;
  const label = describe(numbers, ops, computed);

  if (correct)
    return {
      accepted: true,
      correct: true,
      feedback: { label, state: "correct", detail: "Exactly on target." },
      reveal: { computed, target, delta: 0 },
    };

  const near = Math.abs(delta) <= CLOSE_ENOUGH;
  return {
    accepted: true,
    correct: false,
    feedback: {
      label,
      state: near ? "close" : "wrong",
      detail:
        delta > 0
          ? `${Math.abs(delta)} too low`
          : `${Math.abs(delta)} too high`,
    },
    reveal: { computed, target, delta },
  };
}
