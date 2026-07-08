import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the static build works on GitHub Pages (project subpath) or anywhere.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    // framer-motion must share the app's single React instance.
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "framer-motion"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
