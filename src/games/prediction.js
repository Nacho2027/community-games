import { rngFor } from "../engine/rng.js";
import { roundFor as challengeRound, solve as challengeSolve } from "./challenge.js";

export const meta = {
  id: "prediction",
  title: "Prediction League",
  description:
    "Forecast today's Numbers puzzle before you solve it, and record your confidence.",
  cadence: "daily",
  maxPoints: 100,
};

// Every question is a real, verifiable fact about today's Numbers puzzle that cannot be
// answered by looking at the board: you have to work out the solution. Resolving these by
// coin flip made the game pure luck, with no skill and nothing to learn.
const TEMPLATES = [
  {
    id: "multiply",
    question: "Will today's Numbers solution use multiplication?",
    metric: "today's solution",
    test: (_round, solution) => solution.ops.includes("*"),
  },
  {
    id: "subtract",
    question: "Will today's Numbers solution use subtraction?",
    metric: "today's solution",
    test: (_round, solution) => solution.ops.includes("-"),
  },
  {
    id: "largest",
    question: "Will today's Numbers solution use the largest number in the pool?",
    metric: "today's solution",
    test: (round, solution) => Math.max(...round.pool) === Math.max(...solution.numbers),
  },
  {
    id: "aboveTarget",
    question: "Will the three numbers in today's solution sum to more than the target?",
    metric: "today's solution",
    test: (round, solution) =>
      solution.numbers.reduce((sum, value) => sum + value, 0) > round.target,
  },
  {
    id: "evenCount",
    question: "Will today's solution use more even numbers than odd ones?",
    metric: "today's solution",
    test: (_round, solution) =>
      solution.numbers.filter((value) => value % 2 === 0).length >= 2,
  },
  {
    id: "product",
    question: "Will the plain sum of today's three solution numbers be an even number?",
    metric: "today's solution",
    test: (_round, solution) =>
      solution.numbers.reduce((sum, value) => sum + value, 0) % 2 === 0,
  },
];

const OPTIONS = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

const CONSOLATION_POINTS = 5;
const MIN_CONFIDENCE = 50;
const MAX_CONFIDENCE = 100;

// Derived from today's Numbers puzzle, so the answer is knowable by reasoning but is not
// visible on the board. Never exposed by roundFor; only submit() reveals it.
function outcomeFor(periodKey, templateId) {
  const template =
    TEMPLATES.find((item) => item.id === templateId) ?? TEMPLATES[0];
  const round = challengeRound(periodKey);
  const solution = challengeSolve(round);
  if (!solution) return "no";
  try {
    return template.test(round, solution) ? "yes" : "no";
  } catch {
    return "no";
  }
}

export function roundFor(periodKey) {
  const key = String(periodKey);
  const index = Math.floor(rngFor(`prediction:${key}`)() * TEMPLATES.length);
  const template = TEMPLATES[index] ?? TEMPLATES[0];
  return {
    periodKey: key,
    templateId: template.id,
    question: template.question,
    metric: template.metric,
    options: OPTIONS.map((option) => ({ ...option })),
  };
}

function reject(reason) {
  return { accepted: false, points: 0, result: {}, reveal: { reason }, reason };
}

function clampPoints(points) {
  if (!Number.isFinite(points)) return 0;
  return Math.min(meta.maxPoints, Math.max(0, Math.round(points)));
}

export function submit(round, action) {
  try {
    const periodKey =
      typeof round?.periodKey === "string" ? round.periodKey : null;
    if (!periodKey) return reject("invalid-round");
    if (!action || typeof action !== "object")
      return reject("malformed-action");

    const { pick, confidence } = action;
    if (pick !== "yes" && pick !== "no") return reject("pick");
    if (!Number.isInteger(confidence)) return reject("confidence");
    if (confidence < MIN_CONFIDENCE || confidence > MAX_CONFIDENCE)
      return reject("confidence");

    const outcome = outcomeFor(periodKey, round.templateId);
    const correct = pick === outcome;
    const points = clampPoints(correct ? confidence : CONSOLATION_POINTS);

    return {
      accepted: true,
      points,
      result: { correct, outcome, confidence },
      reveal: {
        outcome,
        correct,
        confidence,
        templateId: round.templateId ?? null,
      },
    };
  } catch {
    return reject("exception");
  }
}
