import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact"
  },
  build: {
    outDir: resolve(rootDir, "media", "webview", "dashboard"),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2020",
    lib: {
      entry: resolve(rootDir, "webview-src", "dashboard", "main.tsx"),
      name: "CodexToolsDashboard",
      formats: ["iife"],
      fileName: () => "dashboard.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
