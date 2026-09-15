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
    el("p", {
      class: "muted",
      text: "Scored on accuracy: naming your true confidence beats always saying 100%, because an overconfident miss costs almost everything.",
    }),
  ];
}

function faction(round) {
  const opening = round.openingVotes ?? {};
  const rows = (round.factions ?? []).map((item) =>
    el("tr", {}, [
      el("td", { text: item.name }),
      el("td", { text: String(opening[item.id] ?? 0) }),
    ]),
  );
  return [
    el("p", { class: "muted", text: round.rule ?? "" }),
    el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", { text: "Faction" }),
        el("th", { text: "Opening turn" }),
      ])),
      el("tbody", {}, rows),
    ]),
    el("p", {
      class: "muted",
      text: `The remaining ${Math.max(0, (round.turns ?? 0) - 1)} turns stay hidden until you commit.`,
    }),
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