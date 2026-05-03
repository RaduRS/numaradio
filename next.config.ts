import type { NextConfig } from "next";

// Content-Security-Policy, Report-Only. Ships as a monitor so broken
// assumptions surface in DevTools without actually blocking resources
// in prod. Flip to `Content-Security-Policy` once the console is clean
// for a day or two.
//
// Scope:
//   script/style: 'self' + 'unsafe-inline' (JSON-LD, CSS-in-JS, and
//     Next's framework bootstrap all emit inline tags)
//   img: B2 + CDN for track artwork, plus data:/blob: for inline SVGs
//     and blob previews
//   media: Icecast stream + CDN-served audio
//   connect: api.numaradio.com for fetches back to the broadcast edge
//   frame-ancestors/base-uri/form-action: lock down the classic
//     click-jacking / form-hijack / base-href footguns
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://f003.backblazeb2.com https://cdn.numaradio.com",
  "media-src 'self' https://api.numaradio.com https://cdn.numaradio.com https://f003.backblazeb2.com",
  "font-src 'self' data:",
  // B2 S3-style endpoint is needed for the song-submit flow: browser
  // uploads .mp3 + artwork directly via presigned PUT URLs to the
  // bucket subdomain. Without this, flipping CSP to enforce mode would
  // break submissions.
  "connect-src 'self' https://api.numaradio.com https://cdn.numaradio.com https://numaradio.s3.eu-central-003.backblazeb2.com",
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

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
