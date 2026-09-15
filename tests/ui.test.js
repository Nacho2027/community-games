// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createLocalAdapter } from "../src/adapters/index.js";
import { createShell } from "../src/ui/shell.js";
import * as challenge from "../src/games/challenge.js";
import * as mystery from "../src/games/mystery.js";
import { periodFor, registry } from "../src/games/index.js";

// End-to-end proof that each game is playable through the real rendered UI:
// click the tab, fill the generated form, submit, and see the score move.

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

async function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  const adapter = createLocalAdapter({ storage: memoryStorage() });
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
});