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
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["repos/**"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
