import "./style.css";
import { detectAdapter } from "./adapters/index.js";
import { createShell } from "./ui/shell.js";

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