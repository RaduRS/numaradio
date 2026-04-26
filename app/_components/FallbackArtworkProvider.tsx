"use client";

import { createContext, useContext } from "react";

// SSR-computed URL of the per-show fallback PNG. Set ONCE in the
// layout server component using server-side `new Date()`, then
// threaded down through a context. Client components consume the
// URL synchronously — never recompute on the client, so React never
// hits a hydration mismatch on the cover's background-image.

const FallbackArtworkContext = createContext<string>("/fallback-artwork/daylight_channel.png");

export function useFallbackArtworkUrl(): string {
  return useContext(FallbackArtworkContext);
}

export function FallbackArtworkProvider({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  return (
    <FallbackArtworkContext.Provider value={url}>
      {children}
    </FallbackArtworkContext.Provider>
  );
}
