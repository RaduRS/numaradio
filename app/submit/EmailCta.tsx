"use client";

import { useState } from "react";
import { CopyIcon, SendIcon } from "../_components/Icons";

type Props = { email: string };

export function EmailCta({ email }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    } catch {
      // Some browsers block clipboard writes from insecure contexts or
      // sandboxed iframes — fail silently, the mailto: CTA still works.
    }
  }

  return (
    <div className="submit-cta">
      <span className="label">Where to send it</span>
      <div className="addr-row">
        <span className="addr">{email}</span>
        <div className="addr-actions">
          <button
            type="button"
            className={`copy-btn${copied ? " copied" : ""}`}
            onClick={copy}
            aria-label="Copy email address"
          >
            <CopyIcon className="" />
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`mailto:${email}`}
            className="btn btn-primary btn-sm"
            style={{ padding: "8px 14px" }}
          >
            <SendIcon className="btn-icon" />
            Email now
          </a>
        </div>
      </div>
    </div>
  );
}
