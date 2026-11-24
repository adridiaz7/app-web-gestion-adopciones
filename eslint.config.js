// @ts-check
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      "uploads/",
      "logs/",
      // The test lock guards the locked tests; it is maintained by the owner, not by the app tasks.
      "scripts/test-lock.ts",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["src/server/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/client/**/*.ts"],
    languageOptions: { globals: globals.browser },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      // Express recognises an error handler by its four parameters, even if some are unused.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
