import { el, field, range, select } from "./dom.js";

// Each builder returns { control, read } where read(form) produces the raw action.
// The game module remains the sole authority on whether an action is legal.

function numberField(name, label, props = {}) {
  const input = el("input", { type: "number", name, required: "", ...props });
  return { node: field(label, input), input };
}

function challenge() {
  const rows = [0, 1, 2].map((index) =>
    numberField(`n${index}`, `Number ${index + 1}`, { min: "0" }),
  );
  const ops = [0, 1].map((index) =>
    field(`Operator ${index + 1}`, select(`op${index}`, [
      { value: "+" },
      { value: "-" },
      { value: "*" },
    ])),
  );
  return {
    nodes: [...rows.map((row) => row.node), ...ops],
    read: (form) => ({
      numbers: rows.map((row) => Number(form.elements[row.input.name].value)),
      ops: ops.map((_, index) => form.elements[`op${index}`].value),
    }),
  };
}

function prediction(round) {
  const choices = (round.options ?? []).map((item) => ({ value: item.id, label: item.label }));
  const pick = select("pick", choices.length ? choices : [{ value: "yes" }, { value: "no" }]);
  const confidence = range("confidence", 50, 100, 5, 70);
  return {
    nodes: [
      field("Your pick", pick),
      field("How sure are you?", confidence),
    ],
    read: (form) => ({
      pick: form.elements.pick.value,
      confidence: Number(form.elements.confidence.value),
    }),
  };
}

function faction(round) {
  const choices = (round.factions ?? []).map((item) => ({ value: item.id, label: item.name }));
  const want = select("factionId", choices.length ? choices : [{ value: "unknown" }]);
  return {
    nodes: [field("Back a faction", want)],
    read: (form) => ({ factionId: form.elements.factionId.value }),
  };
}

function mystery(round) {
  const choices = (round.suspects ?? []).map((item) => ({ value: item.id, label: item.name }));
  const want = select("suspectId", choices.length ? choices : [{ value: "unknown" }]);
  return {
    nodes: [field("Accuse a suspect", want)],
    read: (form) => ({ suspectId: form.elements.suspectId.value }),
  };
}

function economy(round) {
  const buyRows = [];
  const sellRows = [];
  for (const good of round.goods ?? []) {
    const buy = numberField(`buy-${good.id}`, `Buy ${good.name} at ${good.buy}`, { min: "0", value: "0" });
    const sell = numberField(`sell-${good.id}`, `Sell ${good.name} at ${good.sell}`, { min: "0", value: "0" });
    buyRows.push({ good: good.id, input: buy.input });
    sellRows.push({ good: good.id, input: sell.input });
  }
  return {
    nodes: [
      ...buyRows.map((row) => row.input.closest?.("label") ?? row.input.parentElement),
      ...sellRows.map((row) => row.input.closest?.("label") ?? row.input.parentElement),
    ],
    read: (form) => ({
      buy: buyRows.map((row) => ({ goodId: row.good, qty: Number(form.elements[row.input.name].value) })),
      sell: sellRows.map((row) => ({ goodId: row.good, qty: Number(form.elements[row.input.name].value) })),
    }),
  };
}

const BUILDERS = { challenge, prediction, faction, mystery, economy };

export function buildActionForm(gameId, round) {
  const builder = BUILDERS[gameId];
  if (!builder) return { nodes: [], read: () => ({}) };
  return builder(round);
}