import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  applyAction,
  canPlay,
  createLedger,
  pointsFor,
} from "../src/engine/actions.js";

const base = {
  gameId: "economy",
  periodKey: "2026-01-15",
  round: { goods: [] },
};
const scoring = () => ({
  accepted: true,
  points: 7,
  result: { ok: true },
  reveal: { why: "demo" },
});
const refusing = () => ({
  accepted: false,
  points: 0,
  result: {},
  reveal: {},
  reason: "bad-action",
});

describe("applyAction", () => {
  it("awards points once and marks the second submission as duplicate", () => {
    const first = applyAction(createLedger(), {
      ...base,
      action: {},
      submit: scoring,
      now: "2026-01-15T10:00:00.000Z",
    });
    expect(first.accepted).toBe(true);
    expect(first.points).toBe(7);
    expect(first.state.points).toBe(7);

    const second = applyAction(first.state, {
      ...base,
      action: {},
      submit: scoring,
    });
    expect(second.accepted).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.reason).toBe("already-played");
    expect(second.points).toBe(0);
    expect(second.state.points).toBe(7);
    expect(second.state.history).toHaveLength(1);
  });

  it("does not consume the period slot or award points for an invalid action", () => {
    const ledger = createLedger();
    const result = applyAction(ledger, {
      ...base,
      action: { bad: true },
      submit: refusing,
    });
    expect(result.accepted).toBe(false);
    expect(result.duplicate).toBe(false);
    expect(result.reason).toBe("bad-action");
    expect(result.state.points).toBe(0);
    expect(result.state.history).toHaveLength(0);
    expect(canPlay(result.state, base.gameId, base.periodKey)).toBe(true);
  });

  it("never mutates the input ledger or its nested objects", () => {
    const ledger = createLedger();
    const snapshot = JSON.stringify(ledger);
    const result = applyAction(ledger, {
      ...base,
      action: {},
      submit: scoring,
    });
    expect(JSON.stringify(ledger)).toBe(snapshot);
    expect(result.state).not.toBe(ledger);
    expect(result.state.actions).not.toBe(ledger.actions);
    expect(result.state.history).not.toBe(ledger.history);
  });

  it("caps history at the limit and keeps the newest entries", () => {
    let ledger = createLedger();
    for (let index = 0; index < HISTORY_LIMIT + 25; index += 1) {
      const result = applyAction(ledger, {
        gameId: "economy",
        periodKey: `2026-01-${String((index % 28) + 1).padStart(2, "0")}#${index}`,
        action: {},
        submit: scoring,
      });
      expect(result.accepted).toBe(true);
      ledger = result.state;
    }
    expect(ledger.history).toHaveLength(HISTORY_LIMIT);
    expect(ledger.history[0].periodKey).toContain(`#${HISTORY_LIMIT + 24}`);
    expect(ledger.points).toBe((HISTORY_LIMIT + 25) * 7);
  });

  it("rejects malformed requests and a throwing submit", () => {
    const ledger = createLedger();
    expect(applyAction(ledger, {}).reason).toBe("invalid-game-id");
    expect(applyAction(ledger, { gameId: "economy" }).reason).toBe(
      "invalid-period-key",
    );
    expect(
      applyAction(ledger, { gameId: "economy", periodKey: "2026-01-15" })
        .reason,
    ).toBe("missing-submit");
    const thrown = applyAction(ledger, {
      ...base,
      action: {},
      submit: () => {
        throw new Error("boom");
      },
    });
    expect(thrown.accepted).toBe(false);
    expect(thrown.reason).toBe("submit-failed");
    expect(canPlay(thrown.state, base.gameId, base.periodKey)).toBe(true);
  });
});

describe("canPlay and pointsFor", () => {
  it("tracks slots per game and period independently", () => {
    const result = applyAction(createLedger(), {
      ...base,
      action: {},
      submit: scoring,
    });
    expect(canPlay(result.state, "economy", "2026-01-15")).toBe(false);
    expect(canPlay(result.state, "economy", "2026-01-16")).toBe(true);
    expect(canPlay(result.state, "challenge", "2026-01-15")).toBe(true);
    expect(canPlay(result.state, "economy", 42)).toBe(false);
  });

  it("totals points per game", () => {
    let ledger = createLedger();
    ledger = applyAction(ledger, {
      ...base,
      action: {},
      submit: scoring,
    }).state;
    ledger = applyAction(ledger, {
      gameId: "challenge",
      periodKey: "2026-01-15",
      action: {},
      submit: () => ({ accepted: true, points: 5, result: {}, reveal: {} }),
    }).state;
    expect(pointsFor(ledger, "economy")).toBe(7);
    expect(pointsFor(ledger, "challenge")).toBe(5);
    expect(pointsFor(ledger, "mystery")).toBe(0);
  });

  it("sanitizes untrusted stored ledgers", () => {
    const dirty = createLedger({
      actions: {
        "economy:2026-01-15": {
          gameId: "economy",
          periodKey: "2026-01-15",
          points: 3,
          at: "x",
        },
        "bad-key": { gameId: "economy", periodKey: "2026-01-15", points: 99 },
        junk: "nope",
      },
      history: [
        { gameId: "economy", periodKey: "2026-01-15", points: "4", at: "y" },
        null,
        7,
      ],
      points: "not-a-number",
    });
    expect(Object.keys(dirty.actions)).toEqual(["economy:2026-01-15"]);
    expect(dirty.history).toHaveLength(1);
    expect(dirty.history[0].points).toBe(4);
    expect(dirty.points).toBe(4);
  });
});
