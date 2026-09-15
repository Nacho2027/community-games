// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createLocalAdapter } from "../src/adapters/index.js";
import { attemptPoints } from "../src/engine/progress.js";
import * as challenge from "../src/games/challenge.js";
import * as economy from "../src/games/economy.js";
import * as mystery from "../src/games/mystery.js";
import { periodFor, registry } from "../src/games/index.js";
import { STORAGE_KEY } from "../src/state.js";
import { createShell } from "../src/ui/shell.js";

// End-to-end proof that each game is playable through the REAL rendered board.
//
// The previous version of this file drove generated <form> elements. That UI shipped a
// defect that 162 green tests did not catch: every result was rendered with
// JSON.stringify(reveal), so players read raw developer output. These tests interact the
// way a player does (tap the tile, tap the card, step the quantity) and assert on what a
// player would see.

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

function recentDays(count) {
  const days = [];
  const cursor = new Date();
  for (let index = 0; index < count; index += 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

async function mount({ storage = memoryStorage(), submit } = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const adapter = createLocalAdapter({ storage });
  let state = await adapter.load();
  createShell({
    root,
    getState: () => state,
    submit:
      submit ??
      (async (gameId, action) => {
        const outcome = await adapter.submit(gameId, action);
        if (outcome.accepted) state = { ...state, ledger: outcome.state };
        return outcome;
      }),
  });
  return { root, getState: () => state };
}

// Several macrotask turns: the commit handler awaits the adapter, then re-renders.
async function flush(times = 3) {
  for (let index = 0; index < times; index += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function pick(root, title) {
  const button = [...root.querySelectorAll(".picker .pick")].find((node) =>
    node.textContent.includes(title),
  );
  if (!button) throw new Error(`no game chip for ${title}`);
  button.click();
}

function byText(root, selector, text) {
  const node = [...root.querySelectorAll(selector)].find(
    (candidate) => candidate.textContent.trim() === text,
  );
  if (!node) throw new Error(`no ${selector} reading "${text}"`);
  return node;
}

function commitNode(root) {
  return root.querySelector(".go");
}

async function commit(root) {
  commitNode(root).click();
  await flush();
}

// Tap three pool numbers and two operators, in the order the board expects.
async function playNumbers(root, solution) {
  for (let index = 0; index < 3; index += 1) {
    byText(root, ".tile", String(solution.numbers[index])).click();
    if (index < 2) byText(root, ".tile.op", solution.ops[index]).click();
  }
  await commit(root);
}

function roundOf(game, date = new Date()) {
  return game.roundFor(periodFor(game, date));
}

const numbersRound = () => roundOf(challenge);
const numbersSolution = () => challenge.solve(numbersRound());

describe("ui shell", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders a chip for every game", async () => {
    const { root } = await mount();
    const labels = [...root.querySelectorAll(".picker .pick")].map(
      (node) => node.querySelector("span").textContent,
    );
    expect(labels).toEqual(registry.map((game) => game.meta.title));
  });

  it("never renders internal game data as raw JSON", async () => {
    // The exact defect this replaces: src/ui/shell.js used to print
    // JSON.stringify(lastResult.reveal, null, 2) after every guess.
    const { root } = await mount();
    pick(root, challenge.meta.title);

    const wrong = { numbers: numbersRound().pool.slice(0, 3), ops: ["+", "+"] };
    await playNumbers(root, wrong);

    expect(root.querySelectorAll("pre")).toHaveLength(0);
    expect(root.textContent).not.toContain("{");
    expect(root.textContent).not.toContain("reveal");
    expect(root.textContent).not.toContain("debug");
  });

  it("plays Daily Numbers by tapping tiles and pays the ceiling for a first-try solve", async () => {
    const { root, getState } = await mount();
    pick(root, challenge.meta.title);
    await playNumbers(root, numbersSolution());

    expect(getState().ledger.points).toBe(challenge.meta.maxPoints);
    expect(root.querySelector(".verdict")?.textContent).toContain("Solved");
  });

  it("shows a running total while the expression is being built", async () => {
    const { root } = await mount();
    pick(root, challenge.meta.title);
    const pool = numbersRound().pool;
    byText(root, ".tile", String(pool[0])).click();

    expect(root.querySelector(".running").textContent).toContain(
      String(pool[0]),
    );
  });

  it("keeps the day alive after a wrong answer, and pays less for a later solve", async () => {
    // This is the whole point of the rewrite. The old game consumed the day on a wrong
    // answer, so there was no loop to play: one blind guess, then nothing.
    const { root, getState } = await mount();
    pick(root, challenge.meta.title);

    const wrong = { numbers: numbersRound().pool.slice(0, 3), ops: ["+", "+"] };
    await playNumbers(root, wrong);
    expect(getState().ledger.points).toBe(0);
    // Still playable: the verdict is absent and the commit button is back.
    expect(root.querySelector(".verdict")).toBeNull();
    expect(commitNode(root)).toBeTruthy();
    expect(root.querySelectorAll(".row.wrong")).toHaveLength(1);

    await playNumbers(root, numbersSolution());
    const earned = getState().ledger.points;
    expect(earned).toBeGreaterThan(0);
    expect(earned).toBeLessThan(challenge.meta.maxPoints);
    expect(root.querySelector(".verdict")?.textContent).toContain("Solved");
  });

  it("fills a pip per attempt and disables commit until the move is complete", async () => {
    const { root } = await mount();
    pick(root, challenge.meta.title);

    const pips = () => root.querySelectorAll(".pips .pip").length;
    expect(pips()).toBe(challenge.meta.maxAttempts);
    expect(commitNode(root).disabled).toBe(true);

    byText(root, ".tile", String(numbersRound().pool[0])).click();
    expect(commitNode(root).disabled).toBe(true);

    // Take the move back, then play a complete wrong answer.
    root.querySelector(".slot").click();
    const wrong = { numbers: numbersRound().pool.slice(0, 3), ops: ["+", "+"] };
    await playNumbers(root, wrong);
    expect(root.querySelectorAll(".pips .pip.used")).toHaveLength(1);
  });

  it("takes the move back when a filled slot is tapped", async () => {
    const { root } = await mount();
    pick(root, challenge.meta.title);
    const pool = numbersRound().pool;
    byText(root, ".tile", String(pool[0])).click();
    expect(root.querySelector(".slot").textContent).toBe(String(pool[0]));

    root.querySelector(".slot").click();
    expect(root.querySelector(".slot").textContent).toBe("");
  });

  it("plays Community Market through the steppers and pays the ceiling for the best trade", async () => {
    const { root, getState } = await mount();
    const round = roundOf(economy);
    const best = economy.bestAction(round);
    const target = best.buy.find((leg) => leg.qty > 0);
    expect(target).toBeTruthy();

    pick(root, economy.meta.title);
    const name = round.goods.find((good) => good.id === target.goodId).name;
    const row = [...root.querySelectorAll(".good")].find((node) =>
      node.textContent.includes(name),
    );
    expect(row).toBeTruthy();
    const [buyStepper, sellStepper] = row.querySelectorAll(".stepper");
    const plus = (stepper) => stepper.querySelectorAll("button")[1];

    for (let index = 0; index < target.qty; index += 1) {
      plus(buyStepper).click();
      plus(sellStepper).click();
    }
    await commit(root);

    expect(getState().ledger.points).toBe(economy.meta.maxPoints);
    expect(root.querySelector(".verdict")?.textContent).toContain("Solved");
  });

  it("walks Prediction League through its three questions", async () => {
    const { root, getState } = await mount();
    pick(root, "Prediction League");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(root.textContent).toContain(`Question ${attempt} of 3`);
      byText(root, ".card .name", "Yes").click();
      await commit(root);
    }

    const entry =
      getState().ledger.progress[
        `prediction:${periodFor(
          registry.find((game) => game.meta.id === "prediction"),
        )}`
      ];
    expect(entry.finished).toBe(true);
    expect(entry.guesses).toHaveLength(3);
    expect(root.querySelector(".verdict")).toBeTruthy();
  });

  it("walks Faction War through its five turns", async () => {
    const { root, getState } = await mount();
    const game = registry.find((item) => item.meta.id === "faction");
    const round = game.roundFor(periodFor(game));

    pick(root, "Faction War");
    for (let turn = 1; turn <= round.turns; turn += 1) {
      expect(root.textContent).toContain(`Turn ${turn} of ${round.turns}`);
      root.querySelector(".card").click();
      await commit(root);
    }

    const entry = getState().ledger.progress[`faction:${periodFor(game)}`];
    expect(entry.finished).toBe(true);
    expect(entry.guesses).toHaveLength(round.turns);
  });

  it("plays Daily Mystery and clears a suspect on a wrong accusation", async () => {
    const { root, getState } = await mount();
    const round = roundOf(mystery);
    const culprit = mystery.solve(round);

    pick(root, mystery.meta.title);
    const innocent = round.suspects.find((suspect) => suspect.id !== culprit);
    byText(root, ".card .name", innocent.name).click();
    await commit(root);

    expect(getState().ledger.points).toBe(0);
    expect(root.querySelector(".verdict")).toBeNull();

    byText(
      root,
      ".card .name",
      round.suspects.find((s) => s.id === culprit).name,
    ).click();
    await commit(root);

    // Solved on the second of three accusations, so it pays the second-attempt rate.
    expect(getState().ledger.points).toBe(
      attemptPoints(mystery.meta.maxPoints, 2, mystery.meta.maxAttempts),
    );
    expect(getState().ledger.points).toBeLessThan(mystery.meta.maxPoints);
  });

  it("crosses out suspects when a clue is tapped", async () => {
    // The deduction should be something a player does with their hands, not memory.
    const { root } = await mount();
    const round = roundOf(mystery);
    pick(root, mystery.meta.title);

    const index = round.clues.findIndex((clue) =>
      mystery.clueTarget(clue.text),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const clueRow = root.querySelectorAll(".log .row")[index];
    expect(clueRow).toBeTruthy();
    clueRow.click();

    expect(root.querySelectorAll(".card.cleared").length).toBeGreaterThan(0);
  });

  it("surfaces a refused move instead of crashing", async () => {
    const { root } = await mount({
      submit: async () => ({
        accepted: false,
        reason: "nope, try again",
        points: 0,
      }),
    });
    pick(root, challenge.meta.title);
    await playNumbers(root, numbersSolution());

    expect(root.querySelector(".err").textContent).toContain("nope, try again");
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
            guesses: [
              {
                label: "x",
                state: "correct",
                detail: null,
                at: `${periodKey}T00:00:00.000Z`,
              },
            ],
            solved: true,
            finished: true,
            points: 10,
          })),
        },
      }),
    });
    const { root } = await mount({ storage });

    expect(root.querySelector(".stat.flame b").textContent).toBe("3");
    const stats = [...root.querySelectorAll(".stat b")].map(
      (node) => node.textContent,
    );
    expect(stats).toContain("30");
  });

  it("hides the streak on a first visit", async () => {
    const { root } = await mount();
    expect(root.querySelector(".stat.flame")).toBeNull();
  });

  it("copies a spoiler-free result covering every game", async () => {
    const { root } = await mount();
    const button = [...root.querySelectorAll("button")].find((node) =>
      node.textContent.includes("Copy today's result"),
    );
    button.click();
    await flush();

    const preview = root.querySelector(".sharebox");
    expect(preview.textContent).toContain("Community Games");
    expect(preview.textContent).toContain("Total 0");
    for (const game of registry)
      expect(preview.textContent).toContain(game.meta.title);
    for (const leak of ["solution", "culprit", "outcome", "ops"])
      expect(preview.textContent).not.toContain(leak);
  });

  it("still produces the result when the clipboard is unavailable", async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    try {
      const { root } = await mount();
      const button = [...root.querySelectorAll("button")].find((node) =>
        node.textContent.includes("Copy today's result"),
      );
      button.click();
      await flush();
      // Degrades to a visible, selectable result instead of throwing.
      expect(root.querySelector(".sharebox").textContent).toContain(
        "Community Games",
      );
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        value: original,
        configurable: true,
      });
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
    pick(root, challenge.meta.title);
    await playNumbers(root, numbersSolution());

    // The day is still scored in memory even though nothing could be persisted.
    expect(getState().ledger.points).toBe(challenge.meta.maxPoints);
    expect(root.querySelector(".verdict")).toBeTruthy();
  });
});
