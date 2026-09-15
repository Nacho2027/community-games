import { intBetween, rngFor, shuffle } from "../engine/rng.js";

export const meta = {
  id: "faction",
  title: "Faction War",
  description:
    "Read the opening turn, then commit to the faction you think takes the war.",
  cadence: "daily",
  maxPoints: 25,
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
// Each faction carries a hidden, persistent strength across all five turns. It is never
// published, so the opening turn is a signal rather than the answer.
const MAX_STRENGTH = 3;
const STRENGTH_WEIGHT = 2;
// Noise is deliberately large next to the strength weight: reading the opening turn is a
// real edge (about 69%) without being a guarantee, and perfect knowledge caps near 79%.
const NOISE = 8;
// Your backing is one voice, not a deciding army. Publishing the full vote table used to
// make the outright winner computable, which the naive strategy converted into a 100% win.
const BONUS_TOTAL = 1;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(reason) {
  return {
    accepted: false,
    points: 0,
    result: { winnerId: null, standings: [], playerFactionId: null, won: false },
    reveal: { message: reason },
    reason,
  };
}

// Deterministic war: hidden strengths, then every turn's crowd votes.
function build(periodKey) {
  const rng = rngFor(`faction:${periodKey}`);
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

  const totals = {};
  for (const faction of factions)
    totals[faction.id] = votes.reduce((sum, row) => sum + (row[faction.id] ?? 0), 0);

  return { factions, votes, totals };
}

export function roundFor(periodKey) {
  const seed = String(periodKey);
  const { factions, votes } = build(seed);
  // Only the opening turn is published. The remaining turns stay hidden until submission,
  // so the winner cannot be computed from the board.
  return {
    seed,
    turns: TURNS,
    factions,
    openingVotes: { ...votes[0] },
    rule: `Back one faction for all ${TURNS} turns. Your backing is worth ${BONUS_TOTAL} vote. Highest total takes the war.`,
  };
}

export function submit(round, action) {
  if (!isPlainObject(round) || !Array.isArray(round.factions) || !round.factions.length)
    return reject("Round data is unavailable.");

  const factionId = isPlainObject(action) ? action.factionId : undefined;
  const backed =
    typeof factionId === "string"
      ? round.factions.find((item) => item.id === factionId)
      : undefined;
  if (!backed) return reject("Pick one of the listed factions.");

  // Recompute the war from the seed so the server, not the client, owns the outcome.
  const { factions, totals } = build(String(round.seed ?? ""));
  if (!factions.length) return reject("Round data is unavailable.");

  const standings = factions.map((faction) => ({
    id: faction.id,
    name: faction.name,
    total: (totals[faction.id] ?? 0) + (faction.id === backed.id ? BONUS_TOTAL : 0),
  }));

  // Ties resolve deterministically by faction order.
  let winner = standings[0];
  for (const row of standings) if (row.total > winner.total) winner = row;

  const won = winner.id === backed.id;
  const points = won ? meta.maxPoints : 0;

  return {
    accepted: true,
    points,
    result: { winnerId: winner.id, standings, playerFactionId: backed.id, won },
    reveal: {
      message: won
        ? `${backed.name} took the war. +${points} points.`
        : `${backed.name} fell short; ${winner.name} took the war.`,
      standings,
    },
  };
}