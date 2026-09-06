import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    ignorePatterns: ["repos/**"],
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["repos/**"],
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
