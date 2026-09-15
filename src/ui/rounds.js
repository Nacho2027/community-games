import { el } from "./dom.js";

// Public, spoiler-free presentation of each round.
export function describeRound(gameId, round) {
  if (!round) return [el("p", { text: "No round available." })];
  if (gameId === "challenge") return challenge(round);
  if (gameId === "prediction") return prediction(round);
  if (gameId === "faction") return faction(round);
  if (gameId === "mystery") return mystery(round);
  if (gameId === "economy") return economy(round);
  return [el("pre", { text: JSON.stringify(round, null, 2) })];
}

function challenge(round) {
  return [
    el("p", { text: `Target: ${round.target}` }),
    el("p", { class: "muted", text: `Pool: ${(round.pool ?? []).join(", ")}` }),
    el("p", { class: "muted", text: "Use exactly three pool numbers with + - * (evaluated left to right)." }),
  ];
}

function prediction(round) {
  return [
    el("p", { text: round.question ?? "" }),
    el("ul", {}, (round.options ?? []).map((item) => el("li", { text: item.label }))),
  ];
}

function faction(round) {
  const totals = {};
  for (const votes of round.votes ?? [])
    for (const [id, count] of Object.entries(votes)) totals[id] = (totals[id] ?? 0) + count;
  return [
    el("p", { class: "muted", text: `${round.turns ?? 0} turns of crowd votes. Backing a faction adds 5 to its total.` }),
    el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", { text: "Faction" }),
        el("th", { text: "Crowd votes" }),
      ])),
      el("tbody", {}, (round.factions ?? []).map((item) =>
        el("tr", {}, [
          el("td", { text: item.name }),
          el("td", { text: String(totals[item.id] ?? 0) }),
        ]),
      )),
    ]),
  ];
}

function mystery(round) {
  return [
    el("ul", {}, (round.clues ?? []).map((clue) => el("li", { text: clue.text ?? clue }))),
    el("p", { class: "muted", text: "Exactly one suspect survives all clues." }),
  ];
}

function economy(round) {
  return [
    el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", { text: "Good" }),
        el("th", { text: "Buy" }),
        el("th", { text: "Sell" }),
        el("th", { text: "Trend" }),
      ])),
      el("tbody", {}, (round.goods ?? []).map((good) =>
        el("tr", {}, [
          el("td", { text: good.name }),
          el("td", { text: String(good.buy) }),
          el("td", { text: String(good.sell) }),
          el("td", { text: good.trend }),
        ]),
      )),
    ]),
    el("p", { class: "muted", text: `${round.startingCoins} coins, ${round.capacity} units of capacity.` }),
  ];
}