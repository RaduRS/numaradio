import type { Metadata } from "next";
import { Archivo, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { cn } from "@/lib/utils";
import { DashboardNav } from "@/components/dashboard-nav";

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
  title: "Numa Radio — Operator",
  description: "Internal operator dashboard for Numa Radio.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("h-full font-sans", archivo.variable, interTight.variable, jetbrainsMono.variable)}
    >
      <body className="min-h-full flex flex-col">
        <DashboardNav />
        <div className="flex flex-1 flex-col">{children}</div>
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
