import type { MetadataRoute } from "next";

// Static `lastModified` for pages whose content rarely changes. Bump
// these when you actually edit a route — emitting `new Date()` on
// every request makes crawlers treat every page as perpetually
// fresh and waste their budget re-fetching us.
const LAST_TOUCHED = {
  about: new Date("2026-04-01"),
  submit: new Date("2026-04-23"), // last booth-form change (require 'who')
  addToHomeScreen: new Date("2026-04-25"),
  privacy: new Date("2026-01-01"),
};

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://numaradio.com",
      // Home page only — it shows live now-playing data, so a fresh
      // `lastModified` per request actually reflects reality.
      lastModified: new Date(),
      changeFrequency: "always",
      priority: 1,
    },
    {
      url: "https://numaradio.com/add-to-home-screen",
      lastModified: LAST_TOUCHED.addToHomeScreen,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://numaradio.com/about",
      lastModified: LAST_TOUCHED.about,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: "https://numaradio.com/submit",
      lastModified: LAST_TOUCHED.submit,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: "https://numaradio.com/privacy",
      lastModified: LAST_TOUCHED.privacy,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
