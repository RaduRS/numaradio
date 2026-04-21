"use client";

import type { ComponentType } from "react";
import {
  MegaphoneIcon,
  SparklesIcon,
  PlayIcon,
  RadioTowerIcon,
} from "./Icons";

export type TabId = "listen" | "request" | "shout" | "onair";

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
