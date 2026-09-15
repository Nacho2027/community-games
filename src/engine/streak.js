import { dayKey } from "./period.js";
import { keyFor } from "./progress.js";

// Streaks and share text are the retention and acquisition loop. Reddit's developer
// payouts are engagement-based, so returning players are the actual money mechanism.

// Every UTC day with at least one recorded play.
export function playedDays(ledger) {
  const days = new Set();
  for (const entry of ledger?.history ?? []) {
    if (
      typeof entry?.periodKey === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.periodKey)
    )
      days.add(entry.periodKey);
  }
  return days;
}

// Consecutive days played, ending today. If today is untouched the streak is still
// shown from yesterday, so it does not appear to reset before the player returns.
export function dailyStreak(ledger, today = new Date()) {
  const days = playedDays(ledger);
  const cursor = new Date(today);
  if (!days.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

// Copy-paste summary. Deliberately spoiler-free so it is safe to post publicly.
export function shareText(ledger, games, today = new Date()) {
  const date = dayKey(today);
  const lines = [`Community Games ${date}`];
  let total = 0;
  for (const game of games) {
    // Read the current progress ledger, not the retired `actions` map: reading the old
    // shape silently reported every game as "not played" with a total of 0.
    const entry = ledger?.progress?.[keyFor(game.meta.id, date)];
    const points = entry?.finished ? entry.points : null;
    if (points === null) lines.push(`${game.meta.title} - not played`);
    else
      lines.push(
        `${game.meta.title} ${points > 0 ? "\u2705" : "\u274c"} ${points}`,
      );
    total += points ?? 0;
  }
  const streak = dailyStreak(ledger, today);
  lines.push(`Total ${total}${streak > 1 ? ` \u00b7 streak ${streak}` : ""}`);
  return lines.join("\n");
}
