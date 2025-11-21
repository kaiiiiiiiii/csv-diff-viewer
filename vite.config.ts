import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import wasm from "vite-plugin-wasm";
// import topLevelAwait from 'vite-plugin-top-level-await'

const config = defineConfig({
  base: "/csv-diff-viewer/",
  plugins: [
    wasm(),
    // topLevelAwait(),
    devtools(),
    nitro(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
      },
    }),
    viteReact({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
  ],
  build: {
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
  },
});

export default config;
