import { intBetween, rngFor, shuffle } from "../engine/rng.js";

export const meta = {
  id: "mystery",
  title: "Daily Mystery",
  description:
    "Four suspects, four clues, exactly one deduction: name the culprit.",
  cadence: "daily",
  maxPoints: 15,
};

const SUSPECT_NAMES = [
  "The Archivist",
  "The Cartographer",
  "The Clockmaker",
  "The Gardener",
  "The Cellist",
  "The Apothecary",
  "The Ferryman",
  "The Weaver",
];

// Each template states a fact that rules its named suspect out.
const EXCLUSION_TEMPLATES = [
  (name) => `${name} was at sea all night and never entered the manor.`,
  (name) => `${name} was locked in the town jail from dusk until dawn.`,
  (name) => `${name} was three hundred miles away delivering a sealed letter.`,
  (name) => `${name} was bedridden with fever and never left the infirmary.`,
  (name) => `${name} was on stage before two hundred witnesses all evening.`,
  (name) => `${name} was snowed in at the mountain pass until sunrise.`,
];

// Neutral clue: rules nobody out.
const NEUTRAL_CLUES = [
  "The meeting was called at midnight, but the main door was never opened.",
  "A single candle was left burning in the west corridor.",
  "The garden gate was latched from the inside.",
];

function rejected(reason) {
  return {
    accepted: false,
    points: 0,
    result: { correct: false, suspectId: null, culpritId: null },
    reveal: { message: reason },
    reason,
  };
}

function isValidRound(round) {
  return (
    round !== null &&
    typeof round === "object" &&
    typeof round.seed === "string" &&
    Array.isArray(round.suspects) &&
    round.suspects.length > 1 &&
    round.suspects.every(
      (suspect) =>
        suspect &&
        typeof suspect.id === "string" &&
        typeof suspect.name === "string",
    ) &&
    Array.isArray(round.clues) &&
    round.clues.every((clue) => clue && typeof clue.text === "string")
  );
}

/**
 * Deterministic public content for one period.
 *
 * Three clues each rule out a distinct non-culprit suspect; one neutral clue rules out nobody.
 * The culprit is never named in any clue and is never stored as a field,
 * so it can only be derived by reasoning.
 */
export function roundFor(periodKey) {
  const seed = String(periodKey);
  const rng = rngFor(`mystery:${seed}`);

  const names = shuffle(rng, SUSPECT_NAMES).slice(0, 4);
  const suspects = names.map((name, index) => ({ id: `s${index}`, name }));

  const culpritIndex = intBetween(rng, 0, suspects.length - 1);
  const excluded = suspects.filter((_, index) => index !== culpritIndex);

  const templates = shuffle(rng, EXCLUSION_TEMPLATES);
  const order = shuffle(rng, excluded);
  const clues = order.map((suspect, index) => ({
    id: `c${index}`,
    text: templates[index % templates.length](suspect.name),
  }));

  const neutral = NEUTRAL_CLUES[intBetween(rng, 0, NEUTRAL_CLUES.length - 1)];
  clues.push({ id: `c${clues.length}`, text: neutral });

  const shuffled = shuffle(rng, clues).map((clue, index) => ({
    id: `c${index}`,
    text: clue.text,
  }));

  return { seed, suspects, clues: shuffled };
}

/** Suspect ids that the clues rule out, derived from clue text alone. */
export function excludedBy(round) {
  const excluded = new Set();
  for (const clue of round.clues) {
    for (const suspect of round.suspects) {
      if (clue.text.includes(suspect.name)) excluded.add(suspect.id);
    }
  }
  return excluded;
}

/**
 * Recomputes the culprit from the round seed alone.
 * Returns null when the generated puzzle is not uniquely solvable.
 */
export function solve(round) {
  if (!isValidRound(round)) return null;
  const regenerated = roundFor(round.seed);
  const excluded = excludedBy(regenerated);
  const remaining = regenerated.suspects.filter(
    (suspect) => !excluded.has(suspect.id),
  );
  return remaining.length === 1 ? remaining[0].id : null;
}

/** Authoritative scoring. Never throws. */
export function submit(round, action) {
  if (!isValidRound(round)) return rejected("Round data is unavailable.");

  const suspectId =
    action && typeof action === "object" ? action.suspectId : undefined;

  const named =
    typeof suspectId === "string"
      ? round.suspects.find((suspect) => suspect.id === suspectId)
      : undefined;

  if (!named) return rejected("Choose one of the listed suspects.");

  const culpritId = solve(round);
  if (!culpritId) return rejected("This case is not solvable today.");

  const correct = named.id === culpritId;
  const points = correct ? meta.maxPoints : 0;

  return {
    accepted: true,
    points,
    result: { correct, suspectId: named.id, culpritId },
    reveal: {
      message: correct
        ? `Correct: ${named.name}. +${points} points.`
        : `${named.name} was ruled out by the clues.`,
    },
  };
}

export const maxPoints = meta.maxPoints;
