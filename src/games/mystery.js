import { intBetween, pick, rngFor, shuffle } from "../engine/rng.js";

export const meta = {
  id: "mystery",
  title: "Daily Mystery",
  description:
    "Cross-reference every alibi, then name the suspect the evidence cannot rule out.",
  cadence: "daily",
  mode: "solve",
  maxAttempts: 2,
  maxPoints: 100,
};

// Six suspects against two accusations. With four suspects and three accusations a player
// who ignored every clue still won 75% of the time, because each wrong accusation clears a
// suspect and narrows the field for free. Blind guessing now wins 2 in 6 (33.3%), so the
// deduction is worth three times as much as the coin flip.
const SUSPECTS = 6;

const NAMES = [
  "The Archivist",
  "The Cartographer",
  "The Clockmaker",
  "The Gardener",
  "The Cellist",
  "The Apothecary",
  "The Ferryman",
  "The Weaver",
];

// Each suspect is published with a whereabouts and an item. Clues never name a suspect
// and never repeat the attribute they rule out, so the player has to connect the evidence
// to the attribute and then to the person holding it.
export const LOCATIONS = [
  {
    value: "at sea",
    clue: "The harbourmaster swore not a single boat left the docks that night.",
  },
  {
    value: "in the town jail",
    clue: "The constable's ledger shows every cell bolted and empty from dusk to dawn.",
  },
  {
    value: "on stage",
    clue: "Two hundred witnesses watched the whole performance without one absence.",
  },
  {
    value: "snowed in at the pass",
    clue: "The mountain road lay under six feet of snow until sunrise.",
  },
  {
    value: "three hundred miles away",
    clue: "The sealed letter was signed and dated in a city beyond the county line.",
  },
  {
    value: "bedridden in the infirmary",
    clue: "The physician's rounds found every fever patient accounted for until morning.",
  },
  {
    value: "in the clocktower",
    clue: "The tower stair was thick with undisturbed dust from top to bottom.",
  },
  {
    value: "at the county fair",
    clue: "The fair gates were chained shut well before the bells rang.",
  },
];

export const ITEMS = [
  {
    value: "a brass key",
    clue: "Every lock in the house was still bolted from the inside; nothing had been forced.",
  },
  {
    value: "a lit lantern",
    clue: "The corridors were pitch dark, and no lamp had been filled since the week before.",
  },
  {
    value: "a sealed letter",
    clue: "The writing desk was untouched, its wax and ribbon still neatly coiled.",
  },
  {
    value: "a heavy case",
    clue: "The floorboards showed no fresh scuffs or dents anywhere along the hall.",
  },
  {
    value: "a coil of rope",
    clue: "The garden shed was locked and its shelves stocked to the last length.",
  },
  {
    value: "a silver watch",
    clue: "The watchmaker confirmed his display case was complete when the shop closed.",
  },
  {
    value: "a muddy coat",
    clue: "The entrance mat was dry and spotless, and the storm had passed hours earlier.",
  },
  {
    value: "a crate of wine",
    clue: "The cellar inventory matched its ledger exactly, down to the last bottle.",
  },
];

// Atmosphere only. These must not name a suspect or an attribute.
const ATMOSPHERE = [
  "The meeting was called at midnight, but the main door was never opened.",
  "A single candle was left burning in the west corridor.",
  "The longcase clock in the hall had stopped a few minutes before one.",
];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRound(value) {
  return (
    isPlainObject(value) &&
    typeof value.seed === "string" &&
    Array.isArray(value.suspects) &&
    value.suspects.length > 1 &&
    value.suspects.every(
      (suspect) =>
        suspect &&
        typeof suspect.id === "string" &&
        typeof suspect.name === "string" &&
        typeof suspect.whereabouts === "string" &&
        typeof suspect.carried === "string",
    ) &&
    Array.isArray(value.clues) &&
    value.clues.every((clue) => clue && typeof clue.text === "string")
  );
}

function reject(reason) {
  return { accepted: false, reason, correct: false };
}

// Deterministic case. Every suspect holds a distinct whereabouts and a distinct item, so a
// single clue always rules out exactly one person.
export function build(periodKey) {
  const rng = rngFor(`mystery:${String(periodKey)}`);

  const suspects = shuffle(rng, NAMES)
    .slice(0, SUSPECTS)
    .map((name, index) => ({ id: `s${index}`, name }));
  const locations = shuffle(rng, LOCATIONS).slice(0, suspects.length);
  const items = shuffle(rng, ITEMS).slice(0, suspects.length);
  suspects.forEach((suspect, index) => {
    suspect.whereabouts = locations[index].value;
    suspect.carried = items[index].value;
  });

  const culpritIndex = intBetween(rng, 0, suspects.length - 1);
  const innocent = suspects
    .map((_, index) => index)
    .filter((index) => index !== culpritIndex);

  // Exactly one clue per innocent suspect, each drawn from that suspect's own attributes.
  const clues = shuffle(rng, innocent).map((index, order) => {
    const useWhereabouts = intBetween(rng, 0, 1) === 0;
    return {
      id: `c${order}`,
      text: useWhereabouts ? locations[index].clue : items[index].clue,
    };
  });
  clues.push({ id: `c${clues.length}`, text: pick(rng, ATMOSPHERE) });

  return {
    culpritIndex,
    round: {
      seed: String(periodKey),
      suspects,
      clues: shuffle(rng, clues).map((clue, index) => ({
        id: `c${index}`,
        text: clue.text,
      })),
    },
  };
}

export function roundFor(periodKey) {
  return build(periodKey).round;
}

// Which attribute a clue rules out. Exported so tests can rebuild the deduction
// independently of the solver.
export function clueTarget(text) {
  for (const entry of LOCATIONS)
    if (entry.clue === text) return { kind: "whereabouts", value: entry.value };
  for (const entry of ITEMS)
    if (entry.clue === text) return { kind: "carried", value: entry.value };
  return null;
}

// Suspects the evidence cannot place at the scene, derived from the round alone.
export function excludedBy(round) {
  const excluded = new Set();
  if (!isRound(round)) return excluded;
  for (const clue of round.clues) {
    const target = clueTarget(clue.text);
    if (!target) continue; // atmosphere
    for (const suspect of round.suspects)
      if (suspect[target.kind] === target.value) excluded.add(suspect.id);
  }
  return excluded;
}

export function solve(round) {
  if (!isRound(round)) return null;
  const { round: rebuilt, culpritIndex } = build(round.seed);
  return rebuilt.suspects[culpritIndex]?.id ?? null;
}

// Judge one accusation.
//
// A wrong accusation does not end the day: it clears that suspect and costs one of two
// accusations. Every clue rules out exactly one person, so the case is fully solvable by
// reading the evidence, and two accusations is enough to survive a single misread.
export function judge(round, action, context) {
  if (!isRound(round)) return reject("Today's case could not be loaded.");

  const suspectId = isPlainObject(action) ? action.suspectId : undefined;
  const accused =
    typeof suspectId === "string"
      ? round.suspects.find((suspect) => suspect.id === suspectId)
      : undefined;
  if (!accused) return reject("Choose one of the listed suspects.");

  // Derive the culprit from the published evidence rather than trusting the round object.
  const excluded = excludedBy(round);
  const remaining = round.suspects.filter(
    (suspect) => !excluded.has(suspect.id),
  );
  if (remaining.length !== 1) return reject("Today's case is not solvable.");

  const culprit = remaining[0];
  const correct = accused.id === culprit.id;

  const attemptsLeft = Math.max(
    0,
    (Number.isInteger(context?.maxAttempts)
      ? context.maxAttempts
      : meta.maxAttempts) -
      (Number.isInteger(context?.attempt) ? context.attempt : 1),
  );

  return {
    accepted: true,
    correct,
    feedback: {
      label: accused.name,
      state: correct ? "correct" : "wrong",
      detail: correct
        ? "The evidence fits."
        : `The evidence clears ${accused.name}.` +
          (attemptsLeft > 0
            ? ` ${attemptsLeft} accusation${attemptsLeft === 1 ? "" : "s"} left.`
            : " No accusations left."),
    },
    reveal: {
      correct,
      suspectId: accused.id,
      culpritId: culprit.id,
      culpritName: culprit.name,
      // Drives the UI's elimination board without re-deriving the deduction client-side.
      cleared: [...excluded],
    },
  };
}
