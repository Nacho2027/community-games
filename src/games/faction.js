import { intBetween, rngFor, shuffle } from "../engine/rng.js";

export const meta = {
  id: "faction",
  title: "Faction War",
  description:
    "Back one of three factions across five turns of an asynchronous community conflict.",
  cadence: "daily",
  maxPoints: 25,
};

const FACTION_NAMES = [
  "The Northern Compact",
  "The Southern League",
  "The Free Cities",
  "The Iron Guild",
  "The Verdant Court",
  "The Ashen Order",
];

const TURNS = 5;
const BACKING_BONUS = 5;

function rejected(reason) {
  return {
    accepted: false,
    points: 0,
    result: {
      winnerId: null,
      standings: [],
      playerFactionId: null,
      won: false,
      roundValid: false,
    },
    reveal: { message: reason },
    reason,
  };
}

function isValidRound(round) {
  return (
    round !== null &&
    typeof round === "object" &&
    Array.isArray(round.factions) &&
    round.factions.length > 0 &&
    round.factions.every(
      (faction) =>
        faction &&
        typeof faction.id === "string" &&
        typeof faction.name === "string",
    ) &&
    Array.isArray(round.votes) &&
    round.votes.length > 0
  );
}

function crowdTotal(votes, factionId) {
  let total = 0;
  for (const row of votes) {
    const value = row && typeof row === "object" ? row[factionId] : undefined;
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * Deterministic public content for one period.
 * Contains only crowd votes; the winning faction is never stored.
 */
export function roundFor(periodKey) {
  const seed = String(periodKey);
  const rng = rngFor(`faction:${seed}`);

  const names = shuffle(rng, FACTION_NAMES).slice(0, 3);
  const factions = names.map((name, index) => ({ id: `f${index}`, name }));

  const votes = [];
  for (let turn = 0; turn < TURNS; turn += 1) {
    const row = {};
    for (const faction of factions) {
      row[faction.id] = intBetween(rng, 0, 9);
    }
    votes.push(row);
  }

  return { seed, turns: TURNS, factions, votes };
}

/**
 * Authoritative resolution. Never throws.
 * The faction that draws the backing bonus is the only one that can gain from it,
 * so the caller cannot influence other factions' totals.
 */
export function submit(round, action) {
  if (!isValidRound(round)) return rejected("Round data is unavailable.");

  const factionId =
    action && typeof action === "object" ? action.factionId : undefined;

  const chosen =
    typeof factionId === "string"
      ? round.factions.find((faction) => faction.id === factionId)
      : undefined;

  if (!chosen) {
    const standings = round.factions.map((faction) => ({
      id: faction.id,
      name: faction.name,
      total: crowdTotal(round.votes, faction.id),
    }));
    return {
      accepted: false,
      points: 0,
      result: {
        winnerId: null,
        standings,
        playerFactionId: null,
        won: false,
        roundValid: true,
      },
      reveal: { message: "Pick one of the listed factions." },
      reason: "unknown faction",
    };
  }

  const standings = round.factions.map((faction) => ({
    id: faction.id,
    name: faction.name,
    total:
      crowdTotal(round.votes, faction.id) +
      (faction.id === chosen.id ? BACKING_BONUS : 0),
  }));

  // Faction order is the deterministic tie-break: only a strictly higher total displaces the leader.
  let winner = standings[0];
  for (const entry of standings) {
    if (entry.total > winner.total) winner = entry;
  }

  const won = winner.id === chosen.id;
  const points = won ? meta.maxPoints : 0;

  return {
    accepted: true,
    points,
    result: {
      winnerId: winner.id,
      standings,
      playerFactionId: chosen.id,
      won,
      roundValid: true,
    },
    reveal: {
      message: won
        ? `${chosen.name} carried the day. +${points} points.`
        : `${chosen.name} fell short; ${winner.name} took the turn.`,
    },
  };
}

export const maxPoints = meta.maxPoints;
