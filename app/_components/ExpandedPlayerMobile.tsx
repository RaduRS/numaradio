"use client";
import { useState } from "react";
import { TabBar, type TabId } from "./TabBar";

export function ExpandedPlayerMobile() {
  const [tab, setTab] = useState<TabId>("listen");

  return (
    <div className="ep-mobile">
      <div className="ep-mobile-body">
        {tab === "listen" && <div>Listen content — Task 6</div>}
        {tab === "request" && <div>Request content — Task 7</div>}
        {tab === "shout" && <div>Shout content — Task 7</div>}
        {tab === "onair" && <div>On Air content — Task 9</div>}
      </div>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
