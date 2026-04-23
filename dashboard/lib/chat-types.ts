export interface ChatAction {
  id: string;
  name: string;
  args: unknown;
  at: string;
  /** Filled in by `action.result` SSE event. */
  resultOk?: boolean;
  resultSummary?: string;
}

export interface ChatConfirm {
  id: string;
  action: string;
  args: Record<string, unknown>;
  prompt: string;
  /** Local-only: "pending" until operator clicks, "approve" or "cancel" after. */
  decision?: "approve" | "cancel";
  decidedAt?: string;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatTurn {
  id: string;
  role: ChatRole;
  text: string;
  timestamp: string;
  streaming?: boolean;
  actions?: ChatAction[];
  confirms?: ChatConfirm[];
  error?: string;
}

export type ConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline";
