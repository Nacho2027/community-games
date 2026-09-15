import { dailyStreak, shareGame, shareText } from "../engine/streak.js";
import { registry, viewFor } from "../games/index.js";
import { createBoard } from "./board.js";
import { burst, clear, el } from "./dom.js";

// Each game is its own game: its own route, its own title, its own result to share, and its
// own daily board. Five games bundled as one thing had nothing to name and nothing to link
// to, which is most of why nobody could talk about them.
const SLUGS = {
  challenge: "numbers",
  prediction: "predictions",
  faction: "factions",
  mystery: "mystery",
  economy: "market",
};

const SOLO = { available: false, entries: [], you: null, stats: null };

function slugFor(gameId) {
  return SLUGS[gameId] ?? gameId;
}

function gameIdForSlug(slug) {
  const match = registry.find((game) => slugFor(game.meta.id) === slug);
  return match?.meta.id ?? null;
}

// The shell owns presentation only. It never computes a score, never decides whether a move
// is legal, and never renders a game's internal data: the engine and the game modules do
// all of that.
export function createShell({ root, getState, submit, leaderboard = null, doc = globalThis.document }) {
  const boards = new Map();
  const asked = new Set();
  let active = registry[0].meta.id;
  let notice = null;
  let shared = null;
  let board = null;
  let commit = null;
  let busy = false;

  // With no shared board the answer is already known for every game, so seed it. Otherwise
  // the panel would sit on "Loading…" forever waiting for a host that does not exist.
  if (!leaderboard) {
    for (const item of registry) boards.set(item.meta.id, SOLO);
  }

  function syncCommit() {
    if (!commit) return;
    commit.disabled = busy || !board?.read();
  }

  function gameUrl(gameId) {
    const loc = globalThis.location;
    if (!loc) return null;
    return `${loc.origin}${loc.pathname}#/${slugFor(gameId)}`;
  }

  async function copy(text) {
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

  async function onCommit() {
    const action = board?.read();
    if (!action || busy) return;
    busy = true;
    syncCommit();
    try {
      const outcome = await submit(active, action);
      notice = outcome.accepted ? null : (outcome.reason ?? "That move was refused.");
      // A finished period changes the board, so ask for it again.
      if (outcome.finished) {
        boards.delete(active);
        asked.delete(active);
      }
    } finally {
      busy = false;
    }
    render();
  }

  // Boards load lazily per game and are cached, so switching tabs does not refetch.
  async function loadBoard(gameId) {
    if (!leaderboard || asked.has(gameId)) return;
    asked.add(gameId);
    try {
      boards.set(gameId, await leaderboard(gameId));
    } catch {
      boards.set(gameId, SOLO);
    }
    if (active === gameId) render();
  }

  function go(gameId) {
    active = gameId;
    // Render now rather than waiting for the hashchange event, so a tap feels immediate.
    // The listener below then sees the route already matches and does nothing.
    const next = `#/${slugFor(gameId)}`;
    if (globalThis.location && globalThis.location.hash !== next) {
      globalThis.location.hash = next;
    }
    render();
  }

  function syncRoute() {
    const raw = String(globalThis.location?.hash ?? "").replace(/^#\/?/, "");
    const gameId = gameIdForSlug(raw);
    if (gameId) active = gameId;
    else if (globalThis.location?.hash) active = registry[0].meta.id;
  }

  function header(state) {
    const streak = dailyStreak(state.ledger, new Date());
    const stats = [
      el("div", { class: "stat" }, [
        el("b", { text: String(state.ledger.points ?? 0) }),
        el("span", { text: "points" }),
      ]),
    ];
    if (streak > 1) {
      stats.unshift(
        el("div", { class: "stat flame" }, [
          el("b", { text: String(streak) }),
          el("span", { text: "streak" }),
        ]),
      );
    }

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
              notice = null;
              shared = null;
              go(game.meta.id);
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
      return el("span", { class: guess.state === "correct" ? "pip hit" : "pip used" });
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
        if (guess.detail) body.push(el("div", { class: "why", text: guess.detail }));
        return el("li", { class: `row ${guess.state}${shake}` }, [el("div", {}, body)]);
      }),
    );
  }

  function livePanel(view) {
    board = createBoard(active, view.round, { attempt: view.attempt, onChange: syncCommit });
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
    if (won) line = `Solved in ${played} of ${view.maxAttempts}.`;
    else if (view.maxAttempts > 1) line = `No solve. You used all ${view.maxAttempts}.`;

    const headline = won ? "Solved" : "Out of attempts";
    const gain = el("span", { class: "gain", text: `+${earned}` });

    return [
      el("h2", { text: view.game.meta.title }),
      log(view.guesses),
      el("div", { class: `verdict ${won ? "win" : "lose"}` }, [
        el("div", { class: "big" }, [headline, won && earned > 0 ? gain : ""]),
        el("div", { class: "line", text: line }),
        won ? burst(12) : "",
      ]),
      el("div", { class: "share-row" }, [
        el("button", {
          type: "button",
          class: "ghost",
          text: "Share this result",
          onclick: () => copy(shareGame(getState().ledger, view.game, new Date(), gameUrl(view.game.meta.id))),
        }),
      ]),
      el("p", { class: "err", text: notice ?? "" }),
    ];
  }

  function statsLine(stats) {
    if (!stats || !stats.played) return null;
    const parts = [`${stats.played} played`, `${stats.solved} solved`];
    if (stats.firstTry > 0) parts.push(`${stats.firstTry} first try`);
    return el("p", { class: "stat-line", text: parts.join("  ·  ") });
  }

  function rankRow(entry, mine) {
    return el("li", { class: `rank-row${mine ? " mine" : ""}` }, [
      el("span", { class: "rank", text: `${entry.rank}` }),
      el("span", { class: "rank-name", text: entry.name }),
      el("span", { class: "rank-score", text: `${entry.points}` }),
      el("span", { class: "rank-attempts", text: entry.solved ? `${entry.attemptsUsed}` : "—" }),
    ]);
  }

  function leaderboardPanel(view) {
    const gameId = view.game.meta.id;
    const data = boards.get(gameId);

    if (!data) {
      loadBoard(gameId);
      return el("section", { class: "panel" }, [
        el("h3", { text: "Today's board" }),
        el("p", { class: "note", text: "Loading…" }),
      ]);
    }

    if (!data.available) {
      return el("section", { class: "panel" }, [
        el("h3", { text: "Today's board" }),
        el("p", {
          class: "note",
          text: "This build runs entirely in your browser, so there is no shared board yet.",
        }),
      ]);
    }

    const rows = data.entries.length
      ? el(
          "ul",
          { class: "ranks" },
          [
            el("li", { class: "rank-head" }, [
              el("span", { class: "rank", text: "#" }),
              el("span", { class: "rank-name", text: "Player" }),
              el("span", { class: "rank-score", text: "Pts" }),
              el("span", { class: "rank-attempts", text: "Tries" }),
            ]),
            ...data.entries.map((entry) => rankRow(entry, entry.playerId === data.you?.playerId)),
          ],
        )
      : el("p", { class: "note", text: "Nobody has finished this one today. Be the first." });

    const youLine =
      data.you && !data.entries.some((entry) => entry.playerId === data.you.playerId)
        ? el("p", { class: "you-line", text: `You are rank ${data.you.rank}` })
        : null;

    return el("section", { class: "panel" }, [
      el("h3", { text: "Today's board" }),
      statsLine(data.stats),
      rows,
      youLine,
    ]);
  }

  function stage(state) {
    const view = viewFor(state.ledger, active);
    if (!view) return el("p", { class: "hint", text: "That game is unavailable." });
    if (doc) doc.title = `${view.game.meta.title} - Community Games`;
    return el("section", { class: "board" }, [
      view.finished ? finishedPanel(view) : livePanel(view),
      leaderboardPanel(view),
    ]);
  }

  function foot() {
    return el("div", {}, [
      el("div", { class: "foot" }, [
        el("button", {
          type: "button",
          class: "ghost",
          text: "Copy all five",
          onclick: () => copy(shareText(getState().ledger, registry, new Date())),
        }),
        el("span", { class: "note", text: "Spoiler-free — safe to paste anywhere." }),
      ]),
      shared ? el("pre", { class: "sharebox", text: shared }) : "",
    ]);
  }

  function render() {
    const state = getState();
    clear(root);
    root.append(el("div", { class: "app" }, [header(state), picker(state), stage(state), foot()]));
  }

  syncRoute();
  globalThis.addEventListener?.("hashchange", () => {
    // A genuine route change (back/forward, or a pasted link) re-renders. A hash we just
    // wrote ourselves is already on screen, so it is ignored.
    const raw = String(globalThis.location?.hash ?? "").replace(/^#\/?/, "");
    const gameId = gameIdForSlug(raw);
    const target = gameId ?? registry[0].meta.id;
    if (target === active) return;
    active = target;
    notice = null;
    shared = null;
    render();
  });

  render();

  return {
    render,
    setActive: (gameId) => go(gameId),
  };
}