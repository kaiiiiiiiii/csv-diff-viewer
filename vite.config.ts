import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
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
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
      },
    }),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  // native path aliases (tsconfig `paths`)
  resolve: { tsconfigPaths: true },
  optimizeDeps: {
    exclude: ["src-wasm/pkg/csv_diff_wasm_bg.wasm"],
  },
  // Enable SharedArrayBuffer support for multi-threaded WASM (wasm-bindgen-rayon).
  // COEP is require-corp everywhere: the app loads no cross-origin subresources.
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
  build: {
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
  },
  worker: {
    format: "es",
  },
});

export default config;
