import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: { port: 5173 },
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
    globals: false,
  },
});
