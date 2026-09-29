import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@support/domain": "/packages/domain/src/index.ts",
      "@support/shared": "/packages/shared/src/index.ts"
    }
  }
});
