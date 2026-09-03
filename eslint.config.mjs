// =============================================================================
// STRICT ESLint config — PLTS Monitor PWA
// -----------------------------------------------------------------------------
// Unlike the reference Remote-Relay PWA (which disabled 25+ rules), this
// config RESTORES all recommended rules to "error" / "warn" so that genuine
// bugs (unused vars, exhaustive deps, no-explicit-any, etc.) fail the build.
// =============================================================================

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    // Global ignores — MUST stay the only key in this object: in flat config,
    // an object with `ignores` plus any other key (rules, linterOptions…)
    // stops being a global ignore and only scopes THAT object (this mistake
    // once let eslint --fix reformat the generated public/sw.js).
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "public/sw.js",
      // Next.js build artifacts generated into public/ during `next build`
      // (Service Worker ESLint worker, hashed filename). Ignored for the same
      // reason as sw.js — they are machine-generated minified output.
      "public/swe-worker-*.js",
      // [audit-2] Third-party vendored library — minified, not our code.
      // eslint was reporting 80+ errors in these files (pre-existing, not
      // introduced by this audit). They are pinned immutable artifacts.
      "public/vendor/**",
      "scripts/**",
      // PWA push-alarm vanilla (punya suite regresi sendiri di repo
      // kembar; bukan domain lint Next.js/TS)
      "pwa-push-alarm/**",
    ],
  },
  {
    // Modern replacement of the removed @typescript-eslint/no-unused-disable-
    // directive rule (v8): report unused eslint-disable comments as errors.
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // TypeScript — STRICT (restored vs reference which disabled these)
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/ban-ts-comment": "error",
      // NOTE: "@typescript-eslint/no-unused-disable-directive" was removed in
      // typescript-eslint v8 (it crashed `eslint .` with exit 2). The modern
      // equivalent is the core linterOptions below — same behavior, correct home.

      // React — STRICT
      "react-hooks/exhaustive-deps": "error",
      "react/no-unescaped-entities": "warn",
      "react/display-name": "warn",
      "react/prop-types": "off", // TS-only project

      // Next.js
      "@next/next/no-img-element": "warn",
      "@next/next/no-html-link-for-pages": "warn",

      // General — STRICT
      "prefer-const": "error",
      "no-unused-vars": "off", // TS rule covers this
      "no-console": [
        "warn",
        { allow: ["warn", "error"] },
      ],
      "no-debugger": "error",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-irregular-whitespace": "error",
      "no-case-declarations": "warn",
      "no-fallthrough": "error",
      "no-mixed-spaces-and-tabs": "error",
      "no-redeclare": "error",
      "no-unreachable": "error",
      "no-useless-escape": "warn",
    },
  },
];

export default eslintConfig;
