import { rngFor, shuffle } from "../engine/rng.js";
import { roundFor as numbersRound, solve as numbersSolve } from "./challenge.js";

export const meta = {
  id: "prediction",
  title: "Prediction League",
  description: "Three forecasts about today's Numbers puzzle, each with your confidence.",
  cadence: "daily",
  mode: "series",
  maxAttempts: 3,
  maxPoints: 100,
};

// Every question is a real, verifiable fact about today's Numbers puzzle that cannot be
// read off the board: you have to work out the solution. Resolving these by coin flip made
// the original game pure luck with nothing to learn.
export const TEMPLATES = [
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
    question: "Will the solution use the largest number in the pool?",
    metric: "today's solution",
    test: (round, solution) => Math.max(...round.pool) === Math.max(...solution.numbers),
  },
  {
    id: "aboveTarget",
    question: "Will the three solution numbers sum to more than the target?",
    metric: "today's solution",
    test: (round, solution) =>
      solution.numbers.reduce((sum, value) => sum + value, 0) > round.target,
  },
  {
    id: "evenCount",
    question: "Will the solution use more even numbers than odd ones?",
    metric: "today's solution",
    test: (_round, solution) =>
      solution.numbers.filter((value) => value % 2 === 0).length >= 2,
  },
  {
    id: "product",
    question: "Will the plain sum of the three solution numbers be even?",
    metric: "today's solution",
    test: (_round, solution) =>
      solution.numbers.reduce((sum, value) => sum + value, 0) % 2 === 0,
  },
];

const OPTIONS = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

const MIN_CONFIDENCE = 50;
const MAX_CONFIDENCE = 100;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason) {
  return { accepted: false, reason, correct: false, feedback: null };
}

// Proper scoring rule (Brier). Rewarding confidence unconditionally made the slider
// decorative: expected value rose with confidence no matter what you believed, so always
// answering 100% was optimal and calibration did not matter at all. Scoring against the
// squared error instead makes honest reporting the best strategy, and the engine scales
// the series share by this weight.
export function calibrationWeight(confidence, correct) {
  const stated = Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, confidence)) / 100;
  const truth = correct ? 1 : 0;
  return Math.max(0, Math.min(1, 1 - (stated - truth) ** 2));
}

// Derived from today's Numbers puzzle. Knowable by reasoning, never visible on the board.
export function outcomeFor(periodKey, templateId) {
  const template = TEMPLATES.find((item) => item.id === templateId) ?? TEMPLATES[0];
  try {
    const puzzle = numbersRound(periodKey);
    const solution = numbersSolve(puzzle);
    if (!solution) return "no";
    return template.test(puzzle, solution) ? "yes" : "no";
  } catch {
    return "no";
  }
}

export function roundFor(periodKey) {
  const key = String(periodKey);
  const rng = rngFor(`prediction:${key}`);
  const questions = shuffle(rng, TEMPLATES)
    .slice(0, meta.maxAttempts)
    .map((template, index) => ({
      id: `q${index}`,
      templateId: template.id,
      question: template.question,
      metric: template.metric,
      options: OPTIONS.map((option) => ({ ...option })),
    }));

  return { periodKey: key, questions };
}

export function judge(round, action, context) {
  const periodKey = typeof round?.periodKey === "string" ? round.periodKey : null;
  if (!periodKey) return reject("Today's questions are unavailable.");

  const attempt = Number.isInteger(context?.attempt) ? context.attempt : 1;
  const question = Array.isArray(round?.questions) ? round.questions[attempt - 1] : null;
  if (!question) return reject("That question is not part of today's round.");

  if (!isPlainObject(action)) return reject("Choose an outcome and a confidence.");

  const { pick, confidence } = action;
  if (pick !== "yes" && pick !== "no") return reject("Pick yes or no.");
  if (!Number.isInteger(confidence) || confidence < MIN_CONFIDENCE || confidence > MAX_CONFIDENCE)
    return reject(`Confidence must be a whole number from ${MIN_CONFIDENCE} to ${MAX_CONFIDENCE}.`);

  const outcome = outcomeFor(periodKey, question.templateId);
  const correct = pick === outcome;
  const weight = calibrationWeight(confidence, correct);
  const readout = `${pick === "yes" ? "Yes" : "No"} at ${confidence}%`;

  return {
    accepted: true,
    correct,
    weight,
    feedback: {
      label: readout,
      state: correct ? "correct" : "wrong",
      detail: correct
        ? `Right. You called ${confidence}% and it held.`
        : `Wrong. It was ${outcome}.`,
    },
    reveal: {
      questionId: question.id,
      templateId: question.templateId,
      outcome,
      correct,
      confidence,
      weight,
    },
  };
}