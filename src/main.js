import "./style.css";
import { detectAdapter } from "./adapters/index.js";
import { createShell } from "./ui/shell.js";

// Point the static build at a hosted API without touching code:
//   VITE_GAMES_API=https://your-host npm run build
// Without it the build runs entirely in the browser and every board reports itself as
// unavailable, which is the honest state rather than an empty table.
const endpoint = import.meta.env?.VITE_GAMES_API;
if (endpoint) globalThis.__GAMES_API__ = endpoint;

const adapter = detectAdapter();
let state = await adapter.load();

createShell({
  root: document.querySelector("#app"),
  getState: () => state,
  submit: async (gameId, action) => {
    const outcome = await adapter.submit(gameId, action);
    if (outcome.accepted) {
      state = { ...state, ledger: outcome.state };
      await adapter.save(state);
    }
    return outcome;
  },
  leaderboard: (gameId) => adapter.leaderboard(gameId),
});