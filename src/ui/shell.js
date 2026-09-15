import { el, clear } from "./dom.js";
import { buildActionForm } from "./actions.js";
import { describeRound } from "./rounds.js";
import { registry, periodFor } from "../games/index.js";
import { pointsFor } from "../engine/actions.js";
import { dailyStreak, shareText } from "../engine/streak.js";

const TABS = registry.map((game) => game.meta);

export function createShell({ root, getState, submit }) {
  let active = TABS[0].id;
  let lastResult = null;

  function render() {
    const state = getState();
    clear(root);
    root.append(header(state), nav(), panel(state));
  }

  function header(state) {
    const total = state.ledger.points;
    const streak = dailyStreak(state.ledger);
    return el("header", {}, [
      el("h1", { text: "Community Games" }),
      el("p", {
        class: "muted",
        text: "Five daily games. One decision each. Same puzzle for everyone.",
      }),
      el("p", { class: "score" }, [
        `Points: ${total}`,
        streak > 1 ? ` \u00b7 ${streak}-day streak` : "",
      ]),
    ]);
  }

  function nav() {
    const bar = el("nav");
    for (const tab of TABS) {
      bar.append(
        el("button", {
          class: tab.id === active ? "selected" : "",
          text: tab.title,
          onclick: () => {
            active = tab.id;
            lastResult = null;
            render();
          },
        }),
      );
    }
    return bar;
  }

  function panel(state) {
    const game = registry.find((item) => item.meta.id === active);
    const periodKey = periodFor(game);
    const section = el("section", { class: "panel" });
    section.append(el("h2", { text: game.meta.title }));
    section.append(el("p", { class: "muted", text: game.meta.description }));

    if (!state.ledger.actions[`${active}:${periodKey}`]) {
      const round = game.roundFor(periodKey);
      section.append(...describeRound(active, round));
      const built = buildActionForm(active, round);
      const feedback = el("p", { class: "feedback" });
      const form = el("form", {
        onsubmit: async (event) => {
          event.preventDefault();
          const action = built.read(event.target);
          const outcome = await submit(active, action);
          if (outcome.accepted) {
            lastResult = { result: outcome.result, reveal: outcome.reveal };
            render();
          } else {
            feedback.className = "feedback error";
            feedback.textContent = message(outcome.reason);
          }
        },
      }, [...built.nodes, el("button", { type: "submit", text: "Submit" })]);
      section.append(form, feedback);
    } else if (lastResult) {
      section.append(el("p", { class: "positive", text: "Recorded." }));
      if (lastResult.reveal?.summary)
        section.append(el("p", { text: lastResult.reveal.summary }));
      if (lastResult.reveal)
        section.append(el("pre", { class: "result", text: JSON.stringify(lastResult.reveal, null, 2) }));
    } else {
      const entry = state.ledger.actions[`${active}:${periodKey}`];
      section.append(
        el("p", { class: "positive", text: `Already played today for ${entry.points} points.` }),
        el("p", { class: "muted", text: "Come back tomorrow for a new round." }),
      );
    }

    section.append(history(state));
    return section;
  }

  function history(state) {
    const list = el("ul", { class: "history" });
    const recent = state.ledger.history.slice(0, 8);
    if (!recent.length) list.append(el("li", { class: "muted", text: "No plays yet." }));
    for (const entry of recent) {
      const meta = registry.find((game) => game.meta.id === entry.gameId);
      list.append(
        el("li", {
          text: `${meta?.meta.title ?? entry.gameId} - ${entry.points} pts - ${entry.periodKey}`,
        }),
      );
    }
    const scoreboard = el("div", { class: "scoreboard" }, [
      el("h3", { text: "Per-game totals" }),
      el("ul", {}, TABS.map((tab) =>
        el("li", { text: `${tab.title}: ${pointsFor(state.ledger, tab.id)}` }),
      )),
    ]);
    return el("div", { class: "summary" }, [
      el("div", {}, [el("h3", { text: "Recent plays" }), list, shareButton(state)]),
      scoreboard,
    ]);
  }

  // Sharing is the acquisition loop; the text is spoiler-free by construction.
  function shareButton(state) {
    const status = el("span", { class: "muted", text: "" });
    const button = el("button", {
      type: "button",
      text: "Copy today's result",
      onclick: async () => {
        const text = shareText(state.ledger, registry);
        try {
          await navigator.clipboard.writeText(text);
          status.textContent = " Copied.";
        } catch {
          status.textContent = " Select and copy the text below.";
        }
        preview.textContent = text;
      },
    });
    const preview = el("pre", { class: "result" });
    return el("div", { class: "share" }, [button, status, preview]);
  }

  function message(reason) {
    if (reason === "already-played") return "You already played this round.";
    if (reason === "unknown-game") return "Unknown game.";
    return reason ? `Rejected: ${reason}` : "That action was rejected.";
  }

  render();
  return { render };
}