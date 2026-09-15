import { dailyStreak, shareText } from "../engine/streak.js";
import { registry, viewFor } from "../games/index.js";
import { createBoard } from "./board.js";
import { burst, clear, el } from "./dom.js";

// The shell owns presentation only. It never computes a score, never decides whether a move
// is legal, and never renders a game's internal data: the engine and the game modules do
// all of that. The previous version printed `JSON.stringify(result.reveal)` to the screen,
// which is how raw developer output ended up in front of players.
export function createShell({ root, getState, submit }) {
  let active = registry[0].meta.id;
  let notice = null;
  let shared = null;
  let board = null;
  let commit = null;
  let busy = false;

  function syncCommit() {
    if (!commit) return;
    commit.disabled = busy || !board?.read();
  }

  async function onCommit() {
    const action = board?.read();
    if (!action || busy) return;
    busy = true;
    syncCommit();
    try {
      const outcome = await submit(active, action);
      notice = outcome.accepted
        ? null
        : (outcome.reason ?? "That move was refused.");
    } finally {
      busy = false;
    }
    render();
  }

  async function onShare() {
    const text = shareText(getState().ledger, registry, new Date());
    try {
      await navigator.clipboard.writeText(text);
      notice = "Copied. Paste it anywhere.";
      shared = null;
    } catch {
      // Clipboard access is blocked in plenty of real situations, so fall back to
      // something the player can select by hand instead of failing silently.
      shared = text;
      notice = null;
    }
    render();
  }

  function header(state) {
    const streak = dailyStreak(state.ledger, new Date());
    const stats = [
      el("div", { class: "stat" }, [
        el("b", { text: String(state.ledger.points ?? 0) }),
        el("span", { text: "points" }),
      ]),
    ];
    if (streak > 1)
      stats.unshift(
        el("div", { class: "stat flame" }, [
          el("b", { text: String(streak) }),
          el("span", { text: "streak" }),
        ]),
      );

    return el("header", { class: "top" }, [
      el("div", { class: "brand" }, [
        el("h1", { text: "Community Games" }),
        el("span", { class: "sub", text: "Five daily games, one round each" }),
      ]),
      el("div", { class: "stats" }, stats),
    ]);
  }

  function picker(state) {
    return el(
      "nav",
      { class: "picker" },
      registry.map((game) => {
        const view = viewFor(state.ledger, game.meta.id);
        return el(
          "button",
          {
            type: "button",
            class: "pick",
            "aria-current": game.meta.id === active ? "true" : "false",
            onclick: () => {
              active = game.meta.id;
              notice = null;
              shared = null;
              render();
            },
          },
          [
            el("span", { text: game.meta.title }),
            el("span", { class: view?.finished ? "dot done" : "dot" }),
          ],
        );
      }),
    );
  }

  // One pip per allowed attempt; filled as they are spent, green when the call landed.
  function pipNodes(view) {
    return Array.from({ length: view.maxAttempts }, (_, index) => {
      const guess = view.guesses[index];
      if (!guess) return el("span", { class: "pip" });
      return el("span", {
        class: guess.state === "correct" ? "pip hit" : "pip used",
      });
    });
  }

  function log(guesses) {
    if (!guesses.length) return el("div", { class: "log-empty" });
    return el(
      "ul",
      { class: "log" },
      guesses.map((guess, index) => {
        const newest = index === guesses.length - 1;
        const shake = newest && guess.state === "wrong" ? " shake" : "";
        const body = [el("div", { class: "move", text: guess.label })];
        if (guess.detail)
          body.push(el("div", { class: "why", text: guess.detail }));
        return el("li", { class: `row ${guess.state}${shake}` }, [
          el("div", {}, body),
        ]);
      }),
    );
  }

  function livePanel(view) {
    board = createBoard(active, view.round, {
      attempt: view.attempt,
      onChange: syncCommit,
    });
    commit = el("button", {
      type: "button",
      class: "go",
      text: `Lock it in · ${view.attempt} of ${view.maxAttempts}`,
      onclick: onCommit,
    });
    syncCommit();

    return [
      board.node,
      el("div", { class: "pips" }, pipNodes(view)),
      log(view.guesses),
      commit,
      el("p", { class: "err", text: notice ?? "" }),
    ];
  }

  function finishedPanel(view) {
    board = null;
    commit = null;
    const won = view.solved;
    const earned = view.entry?.points ?? 0;
    const played = view.guesses.length;

    let line = "Not this time.";
    if (won)
      line =
        view.maxAttempts > 1
          ? `Solved in ${played} of ${view.maxAttempts}.`
          : "Solved.";
    else if (view.maxAttempts > 1)
      line = `No solve. You used all ${view.maxAttempts}.`;

    const headline = won ? "Solved" : "Out of attempts";
    const gain = el("span", { class: "gain", text: `+${earned}` });

    return [
      el("h2", { text: view.game.meta.title }),
      el("p", { class: "hint", text: "A new round unlocks tomorrow." }),
      log(view.guesses),
      el("div", { class: `verdict ${won ? "win" : "lose"}` }, [
        el("div", { class: "big" }, [headline, won && earned > 0 ? gain : ""]),
        el("div", { class: "line", text: line }),
        won ? burst(12) : "",
      ]),
      el("p", { class: "err", text: notice ?? "" }),
    ];
  }

  function stage(state) {
    const view = viewFor(state.ledger, active);
    if (!view)
      return el("p", { class: "hint", text: "That game is unavailable." });
    return el("section", { class: "board" }, [
      view.finished ? finishedPanel(view) : livePanel(view),
    ]);
  }

  function foot() {
    return el("div", {}, [
      el("div", { class: "foot" }, [
        el("button", {
          type: "button",
          class: "ghost",
          text: "Copy today's result",
          onclick: onShare,
        }),
        el("span", {
          class: "note",
          text: "Spoiler-free — safe to paste anywhere.",
        }),
      ]),
      shared ? el("pre", { class: "sharebox", text: shared }) : "",
    ]);
  }

  function render() {
    const state = getState();
    clear(root);
    root.append(
      el("div", { class: "app" }, [
        header(state),
        picker(state),
        stage(state),
        foot(),
      ]),
    );
  }

  render();

  return {
    render,
    setActive: (gameId) => {
      active = gameId;
      render();
    },
  };
}
