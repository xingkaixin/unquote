import { defineConfig } from "vitest/config";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [svgr()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
