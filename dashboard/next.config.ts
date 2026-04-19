import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  // Dashboard runs on the mini-server; no static export, no edge runtime.
  // Explicit Turbopack root silences the "multiple lockfiles detected" warning
  // (the parent repo has its own lockfile for the main app).
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default config;
