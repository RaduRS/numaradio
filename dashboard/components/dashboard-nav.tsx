"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  { href: "/", label: "Dashboard", match: (p) => p === "/" },
  { href: "/chat", label: "Talkback", match: (p) => p.startsWith("/chat") },
  { href: "/library", label: "Library", match: (p) => p.startsWith("/library") },
  {
    href: "/shoutouts",
    label: "Shoutouts",
    match: (p) => p.startsWith("/shoutouts"),
  },
];

/**
 * Persistent top bar. Identical on every page — fixed width, consistent
 * tabs, one active-underline that slides to the current route. Lives in
 * the root layout so there's literally no chance of a layout jump when
 * navigating.
 *
 * Layout: [logo] ···· [tabs] ···· [operator].
 * Background is a one-pixel glass strip over the dark bg so the rest of
 * the page feels anchored to a console rack rather than floating.
 */
export function DashboardNav() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link
          href="/"
          className="font-display text-lg font-extrabold uppercase tracking-wide text-fg transition-opacity hover:opacity-80 sm:text-xl"
          style={{ fontStretch: "125%" }}
          aria-label="Numa Radio — dashboard home"
        >
          Numa<span className="text-accent">·</span>Radio
        </Link>

        <nav
          aria-label="Primary"
          className="flex items-center gap-0.5 overflow-x-auto sm:gap-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative shrink-0 px-2 py-2 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors sm:px-2.5 sm:text-[11px] sm:tracking-[0.22em] ${
                  active ? "text-fg" : "text-fg-mute hover:text-fg-dim"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent shadow-[0_0_10px_var(--accent-glow)] sm:inset-x-2.5"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-3 sm:flex">
          <StationPulse />
        </div>
      </div>
    </header>
  );
}

/**
 * Tiny always-on-air indicator next to the nav. Purely decorative —
 * it shows the station is "hot" from the operator's POV. Per-page
 * components still render their own real status (connection state,
 * now-playing, service health).
 */
function StationPulse() {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.24em] text-fg-mute">
      <span className="relative inline-flex h-1.5 w-1.5">
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full bg-[--red-live] opacity-70"
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-[--red-live]"
        />
      </span>
      On Air
    </span>
  );
}
