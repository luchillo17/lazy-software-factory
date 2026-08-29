import { defineConfig } from "vitest/config";

/** Non-cached Docker daemon integration suite (fails clearly when Docker missing). */
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/packages/adw-docker",
  test: {
    name: "@lazy-software-factory/adw-docker",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/docker-integration.spec.ts"],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    passWithNoTests: false,
    reporters: ["default"],
  },
}));
