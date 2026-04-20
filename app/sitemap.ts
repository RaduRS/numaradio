import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: "https://numaradio.com",
      lastModified: now,
      changeFrequency: "always",
      priority: 1,
    },
    {
      url: "https://numaradio.com/add-to-home-screen",
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://numaradio.com/about",
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: "https://numaradio.com/submit",
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: "https://numaradio.com/privacy",
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
