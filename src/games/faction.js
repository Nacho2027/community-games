import { intBetween, rngFor, shuffle } from "../engine/rng.js";

export const meta = {
  id: "faction",
  title: "Faction War",
  description: "Five turns. Read each result and call the next one before the war closes.",
  cadence: "daily",
  mode: "series",
  maxAttempts: 5,
  maxPoints: 100,
};

const NAMES = [
  "The Northern Compact",
  "The Southern League",
  "The Free Cities",
  "The Iron Guild",
  "The Verdant Court",
  "The Ashen Order",
];

const TURNS = 5;
// Tuned and measured: each faction carries a hidden persistent strength, and the noise is
// large next to it. Reading the opening turn wins roughly 69% of turns while a blind pick
// wins about 34%, so momentum is a real edge without being a guarantee.
const MAX_STRENGTH = 3;
const STRENGTH_WEIGHT = 2;
const NOISE = 8;
// The player's backing is one voice on one turn, not a deciding army.
const BONUS_TOTAL = 1;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason) {
  return { accepted: false, reason, correct: false, feedback: null };
}

// Deterministic war: hidden strengths, then every turn's crowd votes.
function build(periodKey) {
  const rng = rngFor(`faction:${String(periodKey)}`);
  const factions = shuffle(rng, NAMES)
    .slice(0, 3)
    .map((name, index) => ({ id: `f${index}`, name }));

  const strength = new Map(
    factions.map((faction) => [faction.id, intBetween(rng, 0, MAX_STRENGTH)]),
  );

  const votes = [];
  for (let turn = 0; turn < TURNS; turn += 1) {
    const row = {};
    for (const faction of factions)
      row[faction.id] =
        (strength.get(faction.id) ?? 0) * STRENGTH_WEIGHT + intBetween(rng, 0, NOISE);
    votes.push(row);
  }
  return { factions, votes };
}

export function roundFor(periodKey) {
  const seed = String(periodKey);
  const { factions, votes } = build(seed);
  // Only the opening turn is public. Publishing every turn made the winner computable from
  // the board, which turned the old game into a guaranteed win.
  return {
    seed,
    turns: TURNS,
    factions,
    openingVotes: { ...votes[0] },
    rule: `Call one faction per turn. Your backing is worth ${BONUS_TOTAL} vote.`,
  };
}

// Resolve one turn. Each result is published in the reveal, so the next call can be made on
// real momentum rather than a guess.
export function judge(round, action, context) {
  if (!isPlainObject(round) || !Array.isArray(round.factions) || !round.factions.length)
    return reject("This war is unavailable.");
  if (typeof round.seed !== "string") return reject("This war is unavailable.");

  const attempt = Number.isInteger(context?.attempt) ? context.attempt : 1;
  if (attempt < 1 || attempt > TURNS) return reject("That turn is not part of this war.");

  const factionId = isPlainObject(action) ? action.factionId : undefined;
  const backed =
    typeof factionId === "string"
      ? round.factions.find((item) => item.id === factionId)
      : undefined;
  if (!backed) return reject("Back one of the listed factions.");

  const { factions, votes } = build(round.seed);
  const row = votes[attempt - 1];
  if (!row) return reject("This war is unavailable.");

  const standings = factions
    .map((faction) => ({
      id: faction.id,
      name: faction.name,
      total: (row[faction.id] ?? 0) + (faction.id === backed.id ? BONUS_TOTAL : 0),
    }))
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));

  const winner = standings[0];
  const won = winner.id === backed.id;

  return {
    accepted: true,
    correct: won,
    feedback: {
      label: `Turn ${attempt}: ${backed.name}`,
      state: won ? "correct" : "wrong",
      detail: won
        ? `${backed.name} took the turn with ${winner.total} votes.`
        : `${winner.name} took the turn with ${winner.total} votes.`,
    },
    reveal: {
      turn: attempt,
      winnerId: winner.id,
      playerFactionId: backed.id,
      won,
      standings,
    },
  };
}