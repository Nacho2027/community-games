// Dev-only smoke test of the SHIPPED artifact: load the built bundle (not the source) into a
// DOM and confirm the app actually mounts. jsdom plus the unit tests cover the source; this
// catches anything that only breaks after bundling and minification.
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync("dist/index.html", "utf8");
const asset = readdirSync("dist/assets").find((name) => name.endsWith(".js"));

const dom = new JSDOM(html, {
  url: "https://nacho2027.github.io/community-games/",
});
const w = dom.window;
globalThis.window = w;
globalThis.document = w.document;
globalThis.HTMLElement = w.HTMLElement;
globalThis.Node = w.Node;
globalThis.Event = w.Event;
globalThis.MutationObserver = w.MutationObserver;
globalThis.localStorage = w.localStorage;
Object.defineProperty(globalThis, "navigator", {
  value: w.navigator,
  configurable: true,
});

// The app fetches nothing on load in the local adapter path, but stub fetch to be safe.
globalThis.fetch = async () => {
  throw new Error("unexpected network call on load");
};

// Report only the message: a thrown import error otherwise prints the whole minified bundle.
try {
  await import(`${process.cwd()}/dist/assets/${asset}`);
} catch (error) {
  throw new Error(`bundle failed to execute: ${error.message}`);
}

const app = document.querySelector("#app");
const report = {
  asset,
  appHasChildren: app.children.length > 0,
  gameChips: document.querySelectorAll(".picker .pick").length,
  hasBoard: Boolean(document.querySelector(".board")),
  hasCommit: Boolean(document.querySelector(".go")),
  numTiles: document.querySelectorAll(".tile").length,
  hasShare: Boolean(
    [...document.querySelectorAll("button")].find((n) =>
      n.textContent.includes("Copy today's result"),
    ),
  ),
  hasRawJson: document.body.textContent.includes("{"),
};

for (const [key, value] of Object.entries(report))
  console.log(`  ${key}: ${value}`);

if (
  !report.appHasChildren ||
  report.gameChips !== 5 ||
  !report.hasBoard ||
  report.hasRawJson
)
  throw new Error("shipped bundle did not mount correctly");
console.log("\n  shipped bundle mounts and renders all five games");
