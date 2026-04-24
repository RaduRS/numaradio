import type { NextConfig } from "next";
import path from "node:path";

// Dashboard-side CSP. Tighter than the public site because the dashboard
// is operator-only behind Cloudflare Access — no listener traffic, no
// third-party embeds. Stays Report-Only for now so a missed directive
// shows up in DevTools instead of breaking an operator mid-shift.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://f003.backblazeb2.com https://cdn.numaradio.com",
  "media-src 'self' https://api.numaradio.com https://cdn.numaradio.com https://f003.backblazeb2.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.numaradio.com https://cdn.numaradio.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const config: NextConfig = {
  // Dashboard runs on the mini-server; no static export, no edge runtime.
  // Explicit Turbopack root silences the "multiple lockfiles detected" warning
  // (the parent repo has its own lockfile for the main app).
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default config;
