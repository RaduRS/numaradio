"use client";
// POLLING DISABLED — DB is down, no live data.

import { useEffect, useState } from "react";

type Props = {
  broadcast: boolean;
};

export function BroadcastStage({ broadcast: _broadcast }: Props) {
  // Static placeholder state — no polling, no network calls
  return null;
}