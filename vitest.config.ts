import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["do-tests/**/*.run.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
  },
});
