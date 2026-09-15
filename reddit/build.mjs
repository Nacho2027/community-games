// Build both artifacts the Devvit upload expects:
//   public/            the web client (vite output, copied in)
//   dist-server/index.js   a self-contained server bundle
//
// Devvit requires the server entry to be a single self-contained file, so the shared
// game rules are bundled in rather than referenced across package boundaries.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// 1. Client: reuse the same vite build that GitHub Pages serves.
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

rmSync(join(here, "public"), { recursive: true, force: true });
cpSync(join(root, "dist"), join(here, "public"), { recursive: true });

// 2. Server: bundle the shared rules and the Devvit handlers into one file.
const external = [
  "@devvit/*",
  "node:*",
  "fs",
  "path",
  "crypto",
  "util",
  "stream",
  "events",
  "buffer",
  "url",
  "os",
  "http",
  "https",
  "assert",
  "zlib",
  "tty",
  "net",
  "dns",
  "child_process",
];

rmSync(join(here, "dist-server"), { recursive: true, force: true });
mkdirSync(join(here, "dist-server"), { recursive: true });

await build({
  entryPoints: [join(here, "server/index.js")],
  outfile: join(here, "dist-server/index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external,
  logLevel: "info",
});

console.log("devvit build complete: public/ and dist-server/index.js");
