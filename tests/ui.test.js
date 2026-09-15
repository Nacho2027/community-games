// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createLocalAdapter } from "../src/adapters/index.js";
import { createShell } from "../src/ui/shell.js";
import * as challenge from "../src/games/challenge.js";
import * as mystery from "../src/games/mystery.js";
import { periodFor, registry } from "../src/games/index.js";
import { STORAGE_KEY } from "../src/state.js";

// End-to-end proof that each game is playable through the real rendered UI:
// click the tab, fill the generated form, submit, and see the score move.

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

// Three consecutive UTC days ending today, so the streak is 3.
function recentDays(count) {
  const days = [];
  const cursor = new Date();
  for (let index = 0; index < count; index += 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

async function mount({ storage = memoryStorage() } = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const adapter = createLocalAdapter({ storage });
  let state = await adapter.load();
  createShell({
    root,
    getState: () => state,
    submit: async (gameId, action) => {
      const outcome = await adapter.submit(gameId, action);
      if (outcome.accepted) state = { ...state, ledger: outcome.state };
      return outcome;
    },
  });
  return { root, getState: () => state };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function tab(root, title) {
  const button = [...root.querySelectorAll("nav button")].find(
    (node) => node.textContent === title,
  );
  button.click();
}

async function submitForm(root) {
  const form = root.querySelector("form");
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await flush();
}

function setField(root, name, value) {
  const field = root.querySelector(`[name="${name}"]`);
  field.value = String(value);
  return field;
}

describe("ui shell", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders a tab for every game", async () => {
    const { root } = await mount();
    const labels = [...root.querySelectorAll("nav button")].map((node) => node.textContent);
    expect(labels).toEqual(registry.map((game) => game.meta.title));
  });

  it("plays Daily Numbers through the rendered form", async () => {
    const { root, getState } = await mount();
    const round = challenge.roundFor(periodFor(challenge));
    const solution = challenge.solve(round);

    tab(root, challenge.meta.title);
    solution.numbers.forEach((value, index) => setField(root, `n${index}`, value));
    solution.ops.forEach((value, index) => setField(root, `op${index}`, value));
    await submitForm(root);

    expect(getState().ledger.points).toBe(challenge.meta.maxPoints);
    expect(root.textContent).toContain("Recorded");
  });

  it("plays Daily Mystery through the rendered form", async () => {
    const { root, getState } = await mount();
    const round = mystery.roundFor(periodFor(mystery));
    const culprit = mystery.solve(round);

    tab(root, mystery.meta.title);
    setField(root, "suspectId", culprit);
    await submitForm(root);

    expect(getState().ledger.points).toBe(mystery.meta.maxPoints);
  });

  it("plays Prediction League through the rendered form", async () => {
    const { root, getState } = await mount();
    tab(root, "Prediction League");
    setField(root, "pick", "yes");
    setField(root, "confidence", 90);
    await submitForm(root);

    // Correct pays the stated confidence; incorrect still pays a small consolation.
    expect(getState().ledger.points).toBeGreaterThan(0);
  });

  it("plays Faction War through the rendered form", async () => {
    const { root, getState } = await mount();
    const round = registry.find((game) => game.meta.id === "faction").roundFor(
      periodFor(registry.find((game) => game.meta.id === "faction")),
    );

    tab(root, "Faction War");
    setField(root, "factionId", round.factions[0].id);
    await submitForm(root);

    // Backing a faction always resolves, so the attempt is recorded either way.
    expect(getState().ledger.history).toHaveLength(1);
  });

  it("plays Community Market through the rendered form", async () => {
    const { root, getState } = await mount();
    const game = registry.find((item) => item.meta.id === "economy");
    const round = game.roundFor(periodFor(game));
    const best = [...round.goods].sort((a, b) => b.sell - b.buy - (a.sell - a.buy))[0];

    tab(root, "Community Market");
    setField(root, `buy-${best.id}`, 2);
    setField(root, `sell-${best.id}`, 2);
    await submitForm(root);

    expect(getState().ledger.points).toBeGreaterThan(0);
  });

  it("refuses a second attempt on the same day", async () => {
    const { root, getState } = await mount();
    const round = challenge.roundFor(periodFor(challenge));
    const solution = challenge.solve(round);

    tab(root, challenge.meta.title);
    solution.numbers.forEach((value, index) => setField(root, `n${index}`, value));
    solution.ops.forEach((value, index) => setField(root, `op${index}`, value));
    await submitForm(root);
    const after = getState().ledger.points;

    tab(root, challenge.meta.title);
    expect(root.textContent).toContain("Already played today");
    expect(getState().ledger.points).toBe(after);
  });

  it("shows an error instead of crashing on an invalid action", async () => {
    const { root } = await mount();
    tab(root, challenge.meta.title);
    setField(root, "n0", 999);
    setField(root, "n1", 999);
    setField(root, "n2", 999);
    await submitForm(root);
    expect(root.querySelector(".feedback").textContent).toContain("Rejected");
  });

  it("shows the streak once it is worth bragging about", async () => {
    // Streaks drive returning players, which is what engagement payouts reward.
    const days = recentDays(3);
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        ledger: {
          history: days.map((periodKey) => ({
            gameId: "challenge",
            periodKey,
            points: 10,
            at: `${periodKey}T00:00:00.000Z`,
          })),
        },
      }),
    });
    const { root } = await mount({ storage });
    expect(root.textContent).toContain("3-day streak");
    expect(root.querySelector(".score").textContent).toContain("Points: 30");
  });

  it("hides the streak on a first visit", async () => {
    const { root } = await mount();
    expect(root.textContent).not.toContain("day streak");
  });

  it("copies a spoiler-free result covering every game", async () => {
    const { root } = await mount();
    const button = [...root.querySelectorAll("button")].find(
      (node) => node.textContent === "Copy today's result",
    );
    expect(button).toBeTruthy();
    button.click();
    await flush();

    const preview = root.querySelector(".share .result");
    expect(preview.textContent).toContain("Community Games");
    expect(preview.textContent).toContain("Total 0");
    for (const game of registry) expect(preview.textContent).toContain(game.meta.title);
    // Sharing must never reveal an answer.
    for (const leak of ["solution", "culprit", "outcome", "ops"])
      expect(preview.textContent).not.toContain(leak);
  });

  it("still produces the result when the clipboard is unavailable", async () => {
    // jsdom has no clipboard, and neither do some real browsers on http origins.
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    try {
      const { root } = await mount();
      const button = [...root.querySelectorAll("button")].find(
        (node) => node.textContent === "Copy today's result",
      );
      button.click();
      await flush();
      // Degrades to a visible, selectable result instead of throwing.
      expect(root.querySelector(".share .result").textContent).toContain("Community Games");
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: original, configurable: true });
    }
  });

  it("keeps playing when storage is blocked, as in private browsing", async () => {
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const { root, getState } = await mount({ storage: hostile });
    const round = challenge.roundFor(periodFor(challenge));
    const solution = challenge.solve(round);

    tab(root, challenge.meta.title);
    solution.numbers.forEach((value, index) => setField(root, `n${index}`, value));
    solution.ops.forEach((value, index) => setField(root, `op${index}`, value));
    await submitForm(root);

    // The day is still scored in memory even though nothing could be persisted.
    expect(getState().ledger.points).toBe(challenge.meta.maxPoints);
    expect(root.textContent).toContain("Recorded");
  });
});