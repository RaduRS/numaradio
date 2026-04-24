import type { Metadata, Viewport } from "next";
import { Archivo, Inter_Tight, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { PlayerProvider } from "./_components/PlayerProvider";
import { MiniPlayer } from "./_components/MiniPlayer";
import { ExpandedPlayer } from "./_components/ExpandedPlayer";
import { PresenceHeartbeat } from "./_components/PresenceHeartbeat";
import { NowPlayingSeeder } from "./_components/NowPlayingSeeder";
import { getNowPlayingSnapshot } from "@/lib/now-playing-snapshot";

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
  icons: {
    icon: [{ url: "/logo-mark.png", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/logo-mark.png", sizes: "512x512", type: "image/png" }],
    shortcut: [{ url: "/logo-mark.png", sizes: "512x512", type: "image/png" }],
  },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Numa Radio",
    url: "https://numaradio.com",
    title: "Numa Radio — Always On",
    description:
      "Always-on AI radio. Fresh tracks, live energy, listener requests, hosted by Lena.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Numa Radio — Always On",
    description:
      "Always-on AI radio. Fresh tracks, live energy, listener requests, hosted by Lena.",
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
  // already populated. Falls back to offline state on DB error.
  let initialNowPlaying;
  try {
    initialNowPlaying = await getNowPlayingSnapshot();
  } catch {
    initialNowPlaying = { isPlaying: false, shoutout: { active: false } as const };
  }
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
      </head>
      <body className="min-h-full flex flex-col">
        <NowPlayingSeeder initial={initialNowPlaying} />
        {/* One PlayerProvider for the whole app — keeps the <audio> element
            alive across client-side navigations so playback doesn't cut
            out when the user moves between /, /about, /submit, etc.
            MiniPlayer sits here too so the floating controls survive nav. */}
        <PlayerProvider>
          {children}
          <MiniPlayer />
          <ExpandedPlayer />
        </PlayerProvider>
        <PresenceHeartbeat />
        <Script
          id="ld-json"
          type="application/ld+json"
          strategy="afterInteractive"
        >
          {JSON.stringify({
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
                logo: "https://numaradio.com/apple-icon",
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
          })}
        </Script>
        <Script id="sw-register" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); }); }`}
        </Script>
      </body>
    </html>
  );
}
