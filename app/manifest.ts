import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Numa Radio — Always On",
    short_name: "Numa Radio",
    description:
      "Always-on AI radio. Fresh tracks, live energy, listener requests, hosted by Lena.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B0C0E",
    theme_color: "#0B0C0E",
    categories: ["music", "entertainment"],
    icons: [
      {
        src: "/icon/small",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon/large",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon/maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
