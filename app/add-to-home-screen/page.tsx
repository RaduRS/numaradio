import type { Metadata } from "next";
import { AddToHomeScreenClient } from "./AddToHomeScreenClient";

export const metadata: Metadata = {
  title: "Add Numa Radio to Your Home Screen",
  description:
    "Install Numa Radio as a PWA on iOS, Android, or desktop — full-bleed playback, lock-screen controls, background audio. No app store, no signup.",
  alternates: { canonical: "/add-to-home-screen" },
  openGraph: {
    type: "website",
    siteName: "Numa Radio",
    url: "https://numaradio.com/add-to-home-screen",
    title: "Add Numa Radio to Your Home Screen",
    description:
      "Install Numa Radio as a PWA on iOS, Android, or desktop — full-bleed playback, lock-screen controls, background audio.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Add Numa Radio to Your Home Screen",
    description:
      "Install Numa Radio as a PWA on iOS, Android, or desktop — full-bleed playback, lock-screen controls, background audio.",
  },
};

export default function AddToHomeScreenPage() {
  return <AddToHomeScreenClient />;
}
