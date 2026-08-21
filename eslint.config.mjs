import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      ".tmp/**",
      "main.js",
      "scripts/**",
      "tests/**",
      "*.mjs"
    ]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Practice Problem Generator", "Obsidian", "Markdown", "Border", "Codex", "Claude", "agy"],
          acronyms: ["AI", "CLI", "JSON", "PNG", "GIF", "MP4", "PDF", "URL", "UI", "MCQ", "SHA"]
        }
      ]
    }
  },
  {
    files: ["src/cli/runtime.ts", "src/media-tools.ts", "src/pdf-tools.ts"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        process: "readonly"
      }
    },
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/prefer-window-timers": "off"
    }
  },
  {
    files: ["src/cli/runtime.ts", "src/media-tools.ts", "src/pdf-tools.ts"],
    languageOptions: {
      globals: {
        require: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  {
    files: ["src/settings.ts"],
    rules: {
      "obsidianmd/settings-tab/prefer-setting-definitions": "off"
    }
  },
  {
    files: ["src/main.ts"],
    rules: {
      "obsidianmd/commands/no-plugin-name-in-command-name": "off"
    }
  }
]);
