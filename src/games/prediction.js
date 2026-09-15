import { rngFor } from "../engine/rng.js";

export const meta = {
  id: "prediction",
  title: "Prediction League",
  description:
    "Call today's community outcome and record how confident you were.",
  cadence: "daily",
  maxPoints: 100,
};

const TEMPLATES = [
  {
    id: "players",
    question: "Will today's player count beat yesterday's?",
    metric: "daily players",
  },
  {
    id: "threads",
    question: "Will more than 50 new discussion threads appear today?",
    metric: "new threads",
  },
  {
    id: "retention",
    question: "Will more than half of yesterday's players return today?",
    metric: "returning players",
  },
  {
    id: "streaks",
    question: "Will at least 10 players extend a streak today?",
    metric: "active streaks",
  },
  {
    id: "comments",
    question: "Will a game post reach 100 comments today?",
    metric: "post comments",
  },
  {
    id: "solveRate",
    question: "Will more than a quarter of players solve today's puzzle?",
    metric: "solve rate",
  },
];

const OPTIONS = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

const CONSOLATION_POINTS = 5;
const MIN_CONFIDENCE = 50;
const MAX_CONFIDENCE = 100;

// Roughly even split, deterministic per period, and never exposed by roundFor.
function outcomeFor(periodKey) {
  return rngFor(`prediction-outcome:${periodKey}`)() >= 0.5 ? "yes" : "no";
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

    const outcome = outcomeFor(periodKey);
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
