//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config";

export default [
  ...tanstackConfig,
  {
    ignores: [
      ".output/**",
      "dist/**",
      "node_modules/**",
      "src-wasm/pkg/**",
      "src-wasm/target/**",
      "routeTree.gen.ts",
      "public/**",
      "test-fix.js",
    ],
  },
];
