import { defineConfig } from "vitest/config";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

// Minimal Vite config for tests that avoids loading site-specific plugins (like nitro)
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    // Run tests once (CI style) by default, watch can be used locally with `vitest` CLI options
    // Add test include pattern to only pick up the new tests and component tests
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: { tsconfigPaths: true },
  plugins: [viteReact(), babel({ presets: [reactCompilerPreset()] })],
});
