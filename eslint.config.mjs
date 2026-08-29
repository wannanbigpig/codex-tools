import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["out/**", "node_modules/**", "test/**", "*.js"]
  },
  ...tseslint.configs["flat/recommended-type-checked"],
  {
    files: ["src/**/*.ts", "webview-src/**/*.ts", "webview-src/**/*.tsx", "vite.webview.config.mts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        project: ["./tsconfig.json", "./tsconfig.webview.json", "./tsconfig.eslint.json"],
        sourceType: "module",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/prefer-readonly": "warn",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/require-array-sort-compare": "warn",
      "@typescript-eslint/prefer-includes": "warn",
      "@typescript-eslint/prefer-string-starts-ends-with": "warn",
      "no-console": "off",
      eqeqeq: ["warn", "always", { null: "ignore" }],
      curly: ["warn", "all"],
      "no-caller": "error",
      "no-eval": "error",
      "no-labels": "error",
      "no-new-wrappers": "warn",
      "no-throw-literal": "error",
      radix: "warn",
      "no-irregular-whitespace": "warn"
    }
  }
];
