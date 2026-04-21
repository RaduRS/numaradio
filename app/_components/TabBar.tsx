"use client";

import type { ComponentType, SVGProps } from "react";
import {
  MegaphoneIcon,
  SparklesIcon,
  PlayIcon,
} from "./Icons";

export type TabId = "listen" | "request" | "shout" | "onair";

function RadioTowerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <circle cx="10" cy="10" r="1.5" />
      <path d="M7.5 7.5a3.5 3.5 0 015 0M5.5 5.5a6.5 6.5 0 019 0M10 12l-2 6h4z" />
    </svg>
  );
}

type TabIcon = ComponentType<{ className?: string }>;

const TABS: Array<{ id: TabId; label: string; Icon: TabIcon }> = [
  { id: "listen", label: "Listen", Icon: PlayIcon },
  { id: "request", label: "Request", Icon: SparklesIcon },
  { id: "shout", label: "Shout", Icon: MegaphoneIcon },
  { id: "onair", label: "On Air", Icon: RadioTowerIcon },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  return (
    <nav className="ep-tabbar" role="tablist">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          className={`ep-tab ${active === id ? "active" : ""}`}
          onClick={() => onChange(id)}
        >
          <Icon className="ico" />
          <span className="label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
