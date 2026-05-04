import type { Metadata, Viewport } from "next";
import { Archivo, Inter_Tight, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { PlayerProvider } from "./_components/PlayerProvider";
import { MiniPlayer } from "./_components/MiniPlayer";
import { ExpandedPlayer } from "./_components/ExpandedPlayer";
import { PresenceHeartbeat } from "./_components/PresenceHeartbeat";
import { LiveOnYouTubeBanner } from "./_components/LiveOnYouTubeBanner";
import { NowPlayingSeeder } from "./_components/NowPlayingSeeder";
import { FallbackArtworkProvider } from "./_components/FallbackArtworkProvider";
import { getCachedNowPlayingSnapshot } from "@/lib/now-playing-snapshot";
import { fallbackArtworkSrc, showSlugFor } from "@/lib/show-slug";

// Schema.org graph describing the station. Rendered as an inline
// <script type="application/ld+json"> in <head> so SSR-only crawlers
// see it on first byte (an `afterInteractive` Script wouldn't show up
// until hydration runs, which most crawlers don't do). Following the
// Next.js 16 JSON-LD guide — a native <script> tag is the right vehicle
// for non-executable structured data.
const jsonLdGraph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://numaradio.com/#website",
      url: "https://numaradio.com",
      name: "Numa Radio",
      description:
        "Always-on AI radio. Fresh tracks, live energy, listener requests, hosted by Lena.",
      inLanguage: "en",
      publisher: { "@id": "https://numaradio.com/#org" },
    },
    {
      "@type": "Organization",
      "@id": "https://numaradio.com/#org",
      name: "Numa Radio",
      url: "https://numaradio.com",
      logo: {
        "@type": "ImageObject",
        url: "https://numaradio.com/logo-mark.png",
        contentUrl: "https://numaradio.com/logo-mark.png",
        width: 512,
        height: 512,
      },
      sameAs: [
        "https://www.instagram.com/numa.radio/",
        "https://www.tiktok.com/@numaradio",
        "https://www.youtube.com/@numaradio",
        "https://x.com/NumaRadio",
      ],
    },
    {
      "@type": "BroadcastService",
      "@id": "https://numaradio.com/#broadcast",
      name: "Numa Radio",
      broadcastDisplayName: "Numa Radio",
      url: "https://numaradio.com",
      description:
        "Always-on AI radio hosted by Lena — fresh tracks, live energy, listener requests.",
      inLanguage: "en",
      broadcaster: { "@id": "https://numaradio.com/#org" },
      hasBroadcastChannel: {
        "@type": "BroadcastChannel",
        broadcastServiceTier: "Free",
        inBroadcastLineup: "https://api.numaradio.com/stream",
      },
    },
  ],
};

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://numaradio.com"),
  title: "Numa Radio — Always On",
  description:
    "Always-on AI radio. Fresh tracks, live energy, listener requests, hosted by Lena.",
  applicationName: "Numa Radio",
  manifest: "/manifest.webmanifest",
  // Favicon strategy: Next.js generates the canonical icons from
  // app/icon.tsx (192/512/maskable) and app/apple-icon.tsx, plus
  // app/favicon.ico for the legacy .ico endpoint. Google prefers
  // favicons whose declared size is a multiple of 48 (48, 96, 144,
  // 192, …) — so we don't redeclare /logo-mark.png at 512×512 in
  // metadata.icons; that misled Google's favicon picker. The Next
  // icon route serves 192×192, which is the multiple-of-48 size
  // Google looks for.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Numa Radio",
    url: "https://numaradio.com",
    title: "Numa Radio — Always On",
    description:
      "Always-on AI radio. Fresh tracks, live energy, listener requests, hosted by Lena.",
    // Without an explicit images list, Next.js doesn't auto-include
    // the /opengraph-image route in the og:image meta — link previews
    // on Slack/iMessage/etc. fall back to text-only.
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Numa Radio — Always On",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@NumaRadio",
    creator: "@NumaRadio",
    title: "Numa Radio — Always On",
    description:
      "Always-on AI radio. Fresh tracks, live energy, listener requests, hosted by Lena.",
    images: ["/opengraph-image"],
  },
  appleWebApp: {
    capable: true,
    title: "Numa Radio",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0B0C0E",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Server-fetch the current track so the first paint has artwork/title
  // already populated. Cached 5s via unstable_cache — without this every
  // uncached page visit pays 4 sequential Prisma roundtrips of Vercel
  // Active CPU. Stale window is invisible; client polls catch up on
  // hydrate. Falls back to offline state on DB error.
  let initialNowPlaying;
  try {
    initialNowPlaying = await getCachedNowPlayingSnapshot();
  } catch {
    initialNowPlaying = { isPlaying: false, shoutout: { active: false } as const };
  }
  // Per-show fallback artwork URL — covers the brief window before the
  // real B2 image bytes arrive on the wire. Computed once at SSR using
  // server time so the same URL is in the initial HTML, served as a
  // CSS background-image fallback under the real artwork in PlayerCard
  // / Broadcast / ExpandedPlayer*.
  const fallbackArtUrl = fallbackArtworkSrc(showSlugFor(new Date()));
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${interTight.variable} ${jetbrainsMono.variable} h-full`}
    >
      <head>
        {/* Warm DNS + TCP + TLS to the Icecast stream origin before the
            user clicks play. Shaves a few hundred ms off first-play
            latency, almost free. dns-prefetch as a fallback for older
            browsers. */}
        <link rel="preconnect" href="https://api.numaradio.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://api.numaradio.com" />
        {/* Preload the current artwork so it's in HTTP cache by the time
            MiniPlayer / Broadcast / ExpandedPlayer set it as background-image.
            Closes the "no image on first load" gap. */}
        {initialNowPlaying.artworkUrl ? (
          <link
            rel="preload"
            as="image"
            href={initialNowPlaying.artworkUrl}
            fetchPriority="high"
          />
        ) : null}
        {/* Inline in <head> (not via next/script) so the structured
            data is in the initial SSR HTML. `<` escape defends
            against a payload smuggling a `</script>` if the data
            ever picks up user input. */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLdGraph).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <NowPlayingSeeder initial={initialNowPlaying} />
        {/* "We're live on YouTube" banner — only renders when a YT
            broadcast is active. Hidden on /live itself (you're
            already watching). */}
        <LiveOnYouTubeBanner />
        {/* One PlayerProvider for the whole app — keeps the <audio> element
            alive across client-side navigations so playback doesn't cut
            out when the user moves between /, /about, /submit, etc.
            MiniPlayer sits here too so the floating controls survive nav. */}
        <FallbackArtworkProvider url={fallbackArtUrl}>
          <PlayerProvider>
            {children}
            <MiniPlayer />
            <ExpandedPlayer />
          </PlayerProvider>
        </FallbackArtworkProvider>
        <PresenceHeartbeat />
        <Analytics />
        <Script id="sw-register" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); }); }`}
        </Script>
        {/* iOS WebKit (Safari + Chrome-on-iOS) can restore a backgrounded
            tab in an unstyled state — the DOM comes back but the CSS
            bundle wasn't re-applied. Three paths trigger it:
              1. bfcache restore: pageshow w/ persisted=true
              2. tab evicted from memory then reopened: fresh load whose
                 pageshow already fired before afterInteractive runs
              3. iOS shows a stale snapshot then settles into broken state
                 → caught only when the tab actually becomes visible
            We probe --bg (set on :root by _design-base.css). If the whole
            CSS bundle failed to load it returns empty; we reload once.
            sessionStorage guards against an infinite loop if the network
            error is sticky. Audio playback is preserved in the styled
            case because we never reload then. */}
        <Script id="ios-style-recovery" strategy="afterInteractive">
          {`(function(){var k='numa.cssRecovery';function ok(){try{return !!getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();}catch(_){return true;}}function check(){if(ok()){try{sessionStorage.removeItem(k);}catch(_){}return;}var p=false;try{if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1');p=sessionStorage.getItem(k)==='1';}catch(_){}if(!p)return;try{window.location.reload();}catch(_){}}window.addEventListener('pageshow',check);document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')check();});if(document.readyState==='complete')check();})();`}
        </Script>
      </body>
    </html>
  );
}
