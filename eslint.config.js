import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist", "**/coverage", "**/playwright-report", "**/test-results", "**/node_modules"] },
  {
    // Every workspace: type-aware rules against the nearest tsconfig.json.
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // C9 (docs/05-security.md): the UI renders every string as text and never injects HTML, through
      // React or straight into the DOM. Flat config replaces a rule's options instead of merging them:
      // a later block that sets no-restricted-syntax for web files would silently drop every selector
      // here, so add new web selectors to this list.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Render strings as text; the UI never injects HTML (docs/05-security.md C9).",
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: "Render strings as text; the UI never injects HTML (docs/05-security.md C9).",
        },
        {
          selector: "AssignmentExpression > MemberExpression[property.name=/^(inner|outer)HTML$/]",
          message:
            "Set textContent or render with React; never assign innerHTML/outerHTML (docs/05-security.md C9).",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Insert nodes or text, never an HTML string (docs/05-security.md C9).",
        },
        {
          selector: "MemberExpression[object.name='document'][property.name=/^write(ln)?$/]",
          message: "document.write parses HTML; render with React instead (docs/05-security.md C9).",
        },
      ],
    },
  },
  {
    // The api is server-side only: structured logs, server RNG, env read in one place (ADR 0008 §5).
    files: ["api/**/*.ts"],
    rules: {
      // Fastify plugins and hooks are promise-returning by contract; an `async` body with no `await` is their idiomatic form.
      "@typescript-eslint/require-await": "off",
      "no-console": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use node:crypto (randomInt, randomBytes) in the api.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Only api/src/server.ts, the CLI entry points in api/src/cli/ and api/test/support.ts read process.env; take a Config instead.",
        },
      ],
    },
  },
  {
    files: ["api/src/server.ts", "api/src/cli/*.ts", "api/test/support.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // Test files: allow non-null assertions and unbound methods common in test code.
    files: ["**/*.test.{ts,tsx}", "web/e2e/**/*.ts", "web/src/test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  prettier,
);
