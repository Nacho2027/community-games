import { clueTarget } from "../games/mystery.js";
import { el } from "./dom.js";

// Real interaction instead of form controls.
//
// Every game used to be a <select> or a number input with a Submit button, which is why it
// read as a settings page rather than a game. Each board below is a direct manipulation
// surface: tap tiles, tap cards, step quantities. `read()` returns the action, or null while
// the move is still incomplete, and `onChange` lets the shell enable or disable the commit.
//
// Series games (Faction, Prediction) get `attempt` so they can show the right turn or
// question; solve games ignore it.

const OPS = ["+", "-", "*"];

export function createBoard(gameId, round, options = {}) {
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const attempt = Number.isInteger(options.attempt) ? options.attempt : 1;

  if (gameId === "challenge") return challengeBoard(round, onChange);
  if (gameId === "prediction") return predictionBoard(round, attempt, onChange);
  if (gameId === "faction") return factionBoard(round, attempt, onChange);
  if (gameId === "mystery") return mysteryBoard(round, onChange);
  if (gameId === "economy") return economyBoard(round, onChange);
  return { node: el("p", { class: "hint", text: "This game is unavailable." }), read: () => null };
}

function head(title, text) {
  return [el("h2", { text: title }), el("p", { class: "hint", text })];
}

/* ------------------------------------------------------------------ Daily Numbers */

function challengeBoard(round, onChange) {
  const pool = Array.isArray(round?.pool) ? round.pool : [];
  const target = round?.target;

  // Slots hold an index into the pool, so the same value appearing twice is not ambiguous.
  const picked = [null, null, null];
  const ops = [null, null];

  const slotNodes = [];
  const opNodes = [];
  const running = el("p", { class: "running" });

  const evaluate = () => {
    if (picked[0] === null) return null;
    let total = pool[picked[0]];
    for (let index = 0; index < 2; index += 1) {
      if (ops[index] === null || picked[index + 1] === null) return total;
      const operand = pool[picked[index + 1]];
      if (ops[index] === "+") total += operand;
      else if (ops[index] === "-") total -= operand;
      else total *= operand;
    }
    return total;
  };

  const sync = () => {
    for (const slot of slotNodes)
      slot.node.textContent = slot.index === null ? "_" : String(pool[slot.index]);
    for (const slot of opNodes) slot.node.textContent = slot.value ?? "_";

    for (const tile of tiles) tile.disabled = picked.includes(tile.index);

    const total = evaluate();
    if (total === null) {
      running.textContent = "";
    } else {
      const complete = picked.every((value) => value !== null) && ops.every(Boolean);
      const delta = complete ? target - total : null;
      running.replaceChildren(
        el("span", { text: "Running total " }),
        el("b", { text: String(total) }),
        complete && delta !== 0
          ? el("span", {
              class: "off",
              text: ` · ${Math.abs(delta)} ${delta > 0 ? "too low" : "too high"}`,
            })
          : "",
      );
    }
    onChange();
  };

  const placeNumber = (poolIndex) => {
    const slot = picked.findIndex((value) => value === null);
    if (slot === -1) return;
    picked[slot] = poolIndex;
    sync();
  };

  const clearNumber = (slot) => {
    picked[slot] = null;
    sync();
  };

  const placeOp = (value) => {
    const slot = ops.findIndex((entry) => entry === null);
    if (slot === -1) return;
    ops[slot] = value;
    sync();
  };

  const clearOp = (slot) => {
    ops[slot] = null;
    sync();
  };

  const tiles = pool.map((value, index) =>
    el("button", {
      type: "button",
      class: "tile",
      text: String(value),
      onclick: () => placeNumber(index),
    }),
  );

  const expression = el("div", { class: "expr" });
  for (let index = 0; index < 3; index += 1) {
    const node = el("button", {
      type: "button",
      class: "slot",
      onclick: () => clearNumber(index),
    });
    slotNodes.push({ node, get index() { return picked[index]; } });
    expression.append(node);
    if (index < 2) {
      const opNode = el("button", {
        type: "button",
        class: "slot op",
        onclick: () => clearOp(index),
      });
      opNodes.push({ node: opNode, get value() { return ops[index]; } });
      expression.append(opNode);
    }
  }

  const opRow = el("div", { class: "tiles" }, OPS.map((value) =>
    el("button", {
      type: "button",
      class: "tile op",
      text: value,
      onclick: () => placeOp(value),
    }),
  ));

  const node = el("div", {}, [
    ...head("Reach the target", "Tap three numbers and two operators. Tap a filled slot to take it back."),
    el("div", { class: "target" }, [
      el("span", { class: "cap", text: "Target" }),
      el("span", { class: "num", text: String(target) }),
    ]),
    el("div", { class: "tiles" }, tiles),
    expression,
    running,
    opRow,
  ]);

  sync();

  return {
    node,
    read: () =>
      picked.every((value) => value !== null) && ops.every(Boolean)
        ? { numbers: picked.map((index) => pool[index]), ops: [...ops] }
        : null,
  };
}

/* ---------------------------------------------------------------- Prediction League */

function predictionBoard(round, attempt, onChange) {
  const questions = Array.isArray(round?.questions) ? round.questions : [];
  const question = questions[attempt - 1];

  if (!question) {
    return {
      node: el("div", {}, head("Prediction League", "No questions left for today.")),
      read: () => null,
    };
  }

  let pick = null;
  let confidence = 70;

  const pickRow = el("div", { class: "cards" });
  const buttons = new Map();
  for (const option of question.options ?? []) {
    const button = el("button", {
      type: "button",
      class: "card",
      "aria-pressed": "false",
      onclick: () => {
        pick = option.id;
        for (const [id, entry] of buttons)
          entry.setAttribute("aria-pressed", id === pick ? "true" : "false");
        onChange();
      },
    }, [
      el("span", {}, [el("div", { class: "name", text: option.label })]),
      el("span", { class: "right", text: "" }),
    ]);
    buttons.set(option.id, button);
    pickRow.append(button);
  }

  const readout = el("output", { text: `${confidence}%` });
  const dial = el("input", {
    type: "range",
    min: "50",
    max: "100",
    step: "5",
    value: String(confidence),
    "aria-label": "How sure are you",
    oninput: (event) => {
      confidence = Number(event.target.value);
      readout.textContent = `${confidence}%`;
    },
  });

  const node = el("div", {}, [
    ...head(
      `Question ${attempt} of ${questions.length}`,
      question.question ?? "Make your call.",
    ),
    pickRow,
    el("div", { class: "dial" }, [
      el("span", { class: "cap", text: "Sure" }),
      dial,
      readout,
    ]),
    el("p", {
      class: "note",
      text: "Scored on calibration: naming your real confidence beats always saying 100%, because an overconfident miss gives back almost everything.",
    }),
  ]);

  return { node, read: () => (pick ? { pick, confidence } : null) };
}

/* -------------------------------------------------------------------- Faction War */

function factionBoard(round, attempt, onChange) {
  const factions = Array.isArray(round?.factions) ? round.factions : [];
  const opening = round?.openingVotes ?? {};
  let picked = null;

  const cards = factions.map((faction) => {
    const button = el("button", {
      type: "button",
      class: "card",
      "aria-pressed": "false",
      onclick: () => {
        picked = faction.id;
        for (const [id, entry] of pairs)
          entry.setAttribute("aria-pressed", id === picked ? "true" : "false");
        onChange();
      },
    }, [
      el("span", {}, [
        el("div", { class: "name", text: faction.name }),
        el("div", {
          class: "meta",
          text: attempt === 1 ? `${opening[faction.id] ?? 0} votes in the opening turn` : "committed",
        }),
      ]),
      el("span", { class: "right", text: "back" }),
    ]);
    return button;
  });

  const pairs = new Map(factions.map((faction, index) => [faction.id, cards[index]]));

  const node = el("div", {}, [
    ...head(`Turn ${attempt} of ${round?.turns ?? 5}`, round?.rule ?? "Back a faction."),
    el("div", { class: "cards" }, cards),
  ]);

  return { node, read: () => (picked ? { factionId: picked } : null) };
}

/* ----------------------------------------------------------------- Daily Mystery */

function mysteryBoard(round, onChange) {
  const suspects = Array.isArray(round?.suspects) ? round.suspects : [];
  const clues = Array.isArray(round?.clues) ? round.clues : [];
  let picked = null;

  const cardFor = new Map();

  // Tapping a clue crosses out every suspect that clue rules out. The deduction becomes
  // something you do with your hands instead of holding it in your head. The mapping comes
  // from the game module: clue text is deliberately indirect and never contains the
  // attribute it excludes, so matching on the wording would silently clear nobody.
  const clueList = el(
    "ul",
    { class: "log" },
    clues.map((clue) =>
      el(
        "li",
        {
          class: "row",
          onclick: () => {
            const target = clueTarget(String(clue.text ?? ""));
            if (!target) return;
            for (const suspect of suspects) {
              const node = cardFor.get(suspect.id);
              if (node) node.classList.toggle("cleared", suspect[target.kind] === target.value);
            }
          },
        },
        [el("span", { class: "move", text: String(clue.text ?? "") })],
      ),
    ),
  );

  const cards = suspects.map((suspect) => {
    const button = el("button", {
      type: "button",
      class: "card",
      "aria-pressed": "false",
      onclick: () => {
        picked = suspect.id;
        for (const [id, entry] of pairs)
          entry.setAttribute("aria-pressed", id === picked ? "true" : "false");
        onChange();
      },
    }, [
      el("span", {}, [
        el("div", { class: "name", text: suspect.name }),
        el("div", { class: "meta", text: `${suspect.whereabouts} · carrying ${suspect.carried}` }),
      ]),
      el("span", { class: "right", text: "accuse" }),
    ]);
    cardFor.set(suspect.id, button);
    return button;
  });

  const pairs = new Map(suspects.map((suspect, index) => [suspect.id, cards[index]]));

  const node = el("div", {}, [
    ...head("Name the culprit", "Tap a clue to cross out the suspects it rules out, then accuse."),
    clueList,
    el("div", { class: "cards" }, cards),
  ]);

  return { node, read: () => (picked ? { suspectId: picked } : null) };
}

/* --------------------------------------------------------------- Community Market */

function economyBoard(round, onChange) {
  const goods = Array.isArray(round?.goods) ? round.goods : [];
  const capacity = Number.isInteger(round?.capacity) ? round.capacity : 5;
  const coins = Number.isInteger(round?.startingCoins) ? round.startingCoins : 30;

  const state = new Map(goods.map((good) => [good.id, { buy: 0, sell: 0 }]));
  const readouts = new Map();

  const totals = () => {
    let spend = 0;
    let revenue = 0;
    let held = 0;
    for (const good of goods) {
      const entry = state.get(good.id);
      spend += entry.buy * good.buy;
      revenue += entry.sell * good.sell;
      held += entry.buy;
    }
    return { spend, revenue, held, profit: revenue - spend };
  };

  function sync() {
    const { spend, revenue, held, profit } = totals();
    for (const good of goods) {
      const entry = state.get(good.id);
      const view = readouts.get(good.id);
      view.buyQty.textContent = String(entry.buy);
      view.sellQty.textContent = String(entry.sell);
      view.buyPlus.disabled = held >= capacity || spend + good.buy > coins;
      view.sellPlus.disabled = entry.sell >= entry.buy;
    }
    summary.replaceChildren(
      el("span", { text: `Spend ${spend} · Return ${revenue} · ` }),
      el("b", { text: `Profit ${profit}` }),
      el("span", { class: "note", text: ` · ${held}/${capacity} held` }),
    );
    onChange();
  }

  function step(goodId, side, delta) {
    const entry = state.get(goodId);
    const good = goods.find((item) => item.id === goodId);
    const next = entry[side] + delta;
    if (next < 0) return;

    if (side === "buy") {
      const { spend, held } = totals();
      const extra = delta > 0 ? good.buy : 0;
      if (held + delta > capacity) return;
      if (spend + extra > coins) return;
      // Selling more than you hold is illegal, so buying less than you sold is too.
      if (entry.sell > next) return;
      entry.buy = next;
    } else {
      if (next > entry.buy) return;
      entry.sell = next;
    }
    sync();
  }

  const summary = el("p", { class: "running" });

  const rows = goods.map((good) => {
    const view = {};
    const stepper = (side) => {
      const qty = el("span", { class: "qty", text: "0" });
      const minus = el("button", { type: "button", text: "−", "aria-label": `less ${side}`, onclick: () => step(good.id, side, -1) });
      const plus = el("button", { type: "button", text: "+", "aria-label": `more ${side}`, onclick: () => step(good.id, side, 1) });
      view[side === "buy" ? "buyQty" : "sellQty"] = qty;
      view[side === "buy" ? "buyPlus" : "sellPlus"] = plus;
      return el("span", { class: "stepper" }, [minus, qty, plus]);
    };

    const row = el("div", { class: "good" }, [
      el("div", {}, [
        el("div", { class: "label", text: good.name }),
        el("div", { class: "price", text: `buy ${good.buy} · sell ${good.sell} · ${good.trend}` }),
      ]),
      el("div", {}, [el("div", { class: "note", text: "buy" }), stepper("buy")]),
      el("div", {}, [el("div", { class: "note", text: "sell" }), stepper("sell")]),
    ]);

    readouts.set(good.id, view);
    return row;
  });

  const node = el("div", {}, [
    ...head("Make your trades", `Spend at most ${coins} coins and hold at most ${capacity} units. Buy low, sell high within the day.`),
    el("div", {}, rows),
    summary,
  ]);

  sync();

  return {
    node,
    read: () => {
      const buy = goods.map((good) => ({ goodId: good.id, qty: state.get(good.id).buy }));
      const sell = goods.map((good) => ({ goodId: good.id, qty: state.get(good.id).sell }));
      // A no-op is legal, so this always returns an action.
      return { buy, sell };
    },
  };
}