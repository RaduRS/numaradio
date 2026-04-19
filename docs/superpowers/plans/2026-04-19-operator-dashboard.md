# Numa Radio Operator Dashboard (v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page operator dashboard at `https://dashboard.numaradio.com` that surfaces live status of the Numa Radio broadcast stack (stream, listeners, now-playing, three systemd services, Neon + B2 + tunnel health, logs) and exposes 1-click start/stop/restart for each service, gated by Cloudflare Access.

**Architecture:** Next.js 16 app in `dashboard/` sub-folder, served by the same Cloudflare Tunnel that already fronts the stream. Dashboard runs as user `marku` on port 3001. A narrow `/etc/sudoers.d/numa-dashboard` allowlist gives `marku` password-less access to `systemctl start|stop|restart` for the three broadcast services only. Browser polls a single aggregator endpoint every 5 s, pausing when the tab is hidden.

**Tech Stack:**
- Next.js 16.2.4 + React 19.2.4 + TypeScript (match parent repo)
- Tailwind v4 + shadcn/ui (sonner for toasts, no Radix-only stuff we don't need)
- `pg` for raw Neon queries (no Prisma)
- `@aws-sdk/client-s3` for B2 HEAD probe (reused from parent)
- `node --test` for unit tests (built-in, no jest/vitest)

**Reference spec:** `docs/superpowers/specs/2026-04-19-operator-dashboard-design.md` — this plan implements that spec literally. If any conflict arises, the spec wins.

---

## Phase 0 — Infrastructure wiring (no Next.js code yet)

Everything server-side must work before we write a line of React. Endpoint of this phase: you can `curl https://dashboard.numaradio.com` and get a **502 Bad Gateway** from Cloudflare — proves the tunnel routes to the right port (we just don't have anything listening there yet). After Phase 1, that 502 becomes a 200.

### Task 0.1: Create the sudoers allowlist

**Files:**
- Create: `/etc/sudoers.d/numa-dashboard` (mode 0440, root-owned)

- [ ] **Step 1: Write the sudoers file via visudo-safe pattern**

Run:
```bash
sudo tee /etc/sudoers.d/numa-dashboard > /dev/null <<'EOF'
# Numa Radio operator dashboard — narrow NOPASSWD allowlist for user marku.
# Lets the Next.js dashboard (running as marku) start/stop/restart only the
# three broadcast services. Every other sudo command still requires a password.
marku ALL=(root) NOPASSWD: /usr/bin/systemctl start icecast2, \
                            /usr/bin/systemctl stop icecast2, \
                            /usr/bin/systemctl restart icecast2, \
                            /usr/bin/systemctl start numa-liquidsoap, \
                            /usr/bin/systemctl stop numa-liquidsoap, \
                            /usr/bin/systemctl restart numa-liquidsoap, \
                            /usr/bin/systemctl start cloudflared, \
                            /usr/bin/systemctl stop cloudflared, \
                            /usr/bin/systemctl restart cloudflared
EOF
sudo chmod 0440 /etc/sudoers.d/numa-dashboard
```

- [ ] **Step 2: Let sudo validate the file (must not error)**

Run: `sudo visudo -cf /etc/sudoers.d/numa-dashboard`
Expected: `/etc/sudoers.d/numa-dashboard: parsed OK`

If it errors, the dashboard will not be able to run `sudo systemctl ...` and the error gives the exact line number.

- [ ] **Step 3: Verify it works from the `marku` shell**

Run: `sudo -n systemctl restart numa-liquidsoap && echo RESTART_OK`
Expected: `RESTART_OK` (and no password prompt). The stream will drop for ~2 s.

Also confirm a non-allowlisted command is still blocked:
Run: `sudo -n systemctl restart ssh 2>&1 | head -1`
Expected: `sudo: a password is required`

### Task 0.2: Add dashboard ingress to cloudflared config

**Files:**
- Modify: `/etc/cloudflared/config.yml`

- [ ] **Step 1: Overwrite config with the new ingress rule for `dashboard.numaradio.com`**

Run:
```bash
sudo tee /etc/cloudflared/config.yml > /dev/null <<'EOF'
tunnel: 60c1c3e0-54e5-4331-8992-2ce7d5f9c2ba
credentials-file: /etc/cloudflared/60c1c3e0-54e5-4331-8992-2ce7d5f9c2ba.json

ingress:
  - hostname: api.numaradio.com
    path: /stream
    service: http://localhost:8000
  - hostname: api.numaradio.com
    service: http_status:404
  - hostname: dashboard.numaradio.com
    service: http://localhost:3001
  - service: http_status:404
EOF
```

- [ ] **Step 2: Route `dashboard.numaradio.com` at Cloudflare**

Run: `cloudflared tunnel route dns numaradio dashboard.numaradio.com`
Expected: `INF Added CNAME dashboard.numaradio.com which will route to this tunnel`

(If it errors with "already exists", that's fine — means DNS was already routed.)

- [ ] **Step 3: Restart cloudflared to pick up the new ingress**

Run: `sudo systemctl restart cloudflared && sleep 3 && systemctl is-active cloudflared`
Expected: `active`

- [ ] **Step 4: Verify the public hostname now routes to port 3001 (expect 502 — nothing is listening yet, that's the point)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://dashboard.numaradio.com`
Expected: `502` (tunnel reached the box, nothing on :3001, Cloudflare returns "Bad Gateway"). **Do NOT expect 200 — a 200 at this point would mean something unrelated is serving on :3001.**

If you get 404: cloudflared didn't reload. Re-run step 3.
If you get a Cloudflare Access login page: Access is already set up from a previous attempt — that's fine, fall through to 502 once you authenticate.

### Task 0.3: [MANUAL] Configure Cloudflare Access policy

**Done in the Cloudflare Zero Trust dashboard — not automated.**

- [ ] **Step 1: Open Cloudflare Zero Trust dashboard**

URL: `https://one.dash.cloudflare.com/` → pick your account → **Access** → **Applications** → **Add an application**.

- [ ] **Step 2: Configure the application**

- Application type: **Self-hosted**
- Application name: `Numa Radio Dashboard`
- Session Duration: `24 hours` (you won't have to log in for a day per device)
- Application domain: `dashboard.numaradio.com` (single hostname, no path — gate the whole thing)
- Identity provider: **One-time PIN** (default — emails you a 6-digit code)

- [ ] **Step 3: Add a policy**

Policy name: `Markus only` (or whatever you want)
Action: **Allow**
Rules → Include → **Emails**: add `rsrusu90@gmail.com` (and any other personal emails you want to grant access to).

Save. That's it — `dashboard.numaradio.com` is now gated.

- [ ] **Step 4: Verify the gate actually gates**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -L https://dashboard.numaradio.com`
Expected: Either a `302` (redirect to Cloudflare login) or the login page HTML with `200` — the important thing is it does **not** reach your backend (still 502) and it does **not** return unauthorized content.

Open `https://dashboard.numaradio.com` in a browser → expect the Cloudflare Access login page (email + PIN flow).

### Task 0.4: Commit the Phase 0 reference copy (documentation, not the real /etc files)

The real config files are in `/etc/` and can't be committed from there. But we keep canonical copies in the repo for reproducibility and so the next session knows what's deployed.

**Files:**
- Create: `dashboard/deploy/sudoers-numa-dashboard`
- Create: `dashboard/deploy/cloudflared-config-reference.yml`

- [ ] **Step 1: Create `dashboard/deploy/` and write the reference copies**

Run:
```bash
mkdir -p /home/marku/saas/numaradio/dashboard/deploy
cd /home/marku/saas/numaradio

cat > dashboard/deploy/sudoers-numa-dashboard <<'EOF'
# Numa Radio operator dashboard — narrow NOPASSWD allowlist for user marku.
# Installed to: /etc/sudoers.d/numa-dashboard  (mode 0440, owned by root)
# Validate after edits: sudo visudo -cf /etc/sudoers.d/numa-dashboard
marku ALL=(root) NOPASSWD: /usr/bin/systemctl start icecast2, \
                            /usr/bin/systemctl stop icecast2, \
                            /usr/bin/systemctl restart icecast2, \
                            /usr/bin/systemctl start numa-liquidsoap, \
                            /usr/bin/systemctl stop numa-liquidsoap, \
                            /usr/bin/systemctl restart numa-liquidsoap, \
                            /usr/bin/systemctl start cloudflared, \
                            /usr/bin/systemctl stop cloudflared, \
                            /usr/bin/systemctl restart cloudflared
EOF

cat > dashboard/deploy/cloudflared-config-reference.yml <<'EOF'
# Reference copy of /etc/cloudflared/config.yml — keep in sync when you edit the /etc one.
tunnel: 60c1c3e0-54e5-4331-8992-2ce7d5f9c2ba
credentials-file: /etc/cloudflared/60c1c3e0-54e5-4331-8992-2ce7d5f9c2ba.json

ingress:
  - hostname: api.numaradio.com
    path: /stream
    service: http://localhost:8000
  - hostname: api.numaradio.com
    service: http_status:404
  - hostname: dashboard.numaradio.com
    service: http://localhost:3001
  - service: http_status:404
EOF
```

- [ ] **Step 2: Commit Phase 0 reference files**

```bash
cd /home/marku/saas/numaradio
git add dashboard/deploy/
git commit -m "ops: add operator-dashboard deploy references (sudoers, cloudflared ingress)"
```

---

## Phase 1 — Scaffold the Next.js dashboard

Endpoint of this phase: a "Numa Radio Dashboard — hello" page reachable at `https://dashboard.numaradio.com` after the Cloudflare Access login.

### Task 1.1: Create `dashboard/` folder + `package.json`

**Files:**
- Create: `dashboard/package.json`

- [ ] **Step 1: Initialize `dashboard/package.json` with exact versions matching the parent**

Run:
```bash
cd /home/marku/saas/numaradio/dashboard
```

Create the file with this content:

```json
{
  "name": "numaradio-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "eslint",
    "test": "node --test --experimental-strip-types 'lib/**/*.test.ts'",
    "smoke": "node --experimental-strip-types scripts/smoke.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.1032.0",
    "next": "16.2.4",
    "pg": "^8.20.0",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "sonner": "^2.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/pg": "^8.20.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.4",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

### Task 1.2: Create TypeScript + Next.js + PostCSS configs

**Files:**
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/next.config.ts`
- Create: `dashboard/postcss.config.mjs`
- Create: `dashboard/next-env.d.ts` (actually created by next, but we add to gitignore)

- [ ] **Step 1: Create `dashboard/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Create `dashboard/next.config.ts`**

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  // Dashboard runs on the mini-server; no static export, no edge runtime.
  // Leave everything default.
};

export default config;
```

- [ ] **Step 3: Create `dashboard/postcss.config.mjs`**

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

### Task 1.3: Install dependencies

- [ ] **Step 1: Install**

Run: `cd /home/marku/saas/numaradio/dashboard && npm install --no-audit --no-fund`
Expected: `added <N> packages in <time>` (N ≈ 350-500).

- [ ] **Step 2: Confirm Next.js is the expected version**

Run: `npx next --version`
Expected: `16.2.4`

### Task 1.4: Write global CSS with mirrored design tokens

**Files:**
- Create: `dashboard/app/globals.css`

- [ ] **Step 1: Create `dashboard/app/globals.css` echoing parent tokens**

```css
@import "tailwindcss";

/* ─── Numa Radio design tokens (mirrored from parent app/globals.css) ─── */

:root {
  --bg: #0b0c0e;
  --bg-1: #0f1114;
  --bg-2: #14171b;
  --bg-3: #1a1e23;

  --line: rgb(255 255 255 / 0.07);
  --line-strong: rgb(255 255 255 / 0.14);

  --fg: #f2f0ea;
  --fg-dim: #a8a69d;
  --fg-mute: #6b6b68;

  --accent: #4fd1c5;
  --accent-glow: rgb(79 209 197 / 0.35);
  --accent-soft: rgb(79 209 197 / 0.12);

  --red-live: #ff4d4d;
  --warm: #e8d9b0;
  --ok: #4fd1c5;
  --warn: #f5b400;
  --bad: #ff4d4d;
}

@theme inline {
  --color-bg: var(--bg);
  --color-bg-1: var(--bg-1);
  --color-bg-2: var(--bg-2);
  --color-bg-3: var(--bg-3);

  --color-fg: var(--fg);
  --color-fg-dim: var(--fg-dim);
  --color-fg-mute: var(--fg-mute);

  --color-accent: var(--accent);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);

  --color-ok: var(--ok);
  --color-warn: var(--warn);
  --color-bad: var(--bad);

  --font-display: var(--font-archivo);
  --font-sans: var(--font-inter-tight);
  --font-mono: var(--font-jetbrains-mono);
}

html,
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-inter-tight), system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

body {
  min-height: 100vh;
}

@keyframes numa-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.9); }
}
```

### Task 1.5: Write the root layout and placeholder page

**Files:**
- Create: `dashboard/app/layout.tsx`
- Create: `dashboard/app/page.tsx`

- [ ] **Step 1: Create `dashboard/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Archivo, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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
      className={`${archivo.variable} ${interTight.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Create `dashboard/app/page.tsx` (placeholder — real UI arrives in Phase 5)**

```tsx
export default function OperatorDashboard() {
  return (
    <main className="flex flex-1 items-center justify-center p-12">
      <div className="flex flex-col items-center gap-4 text-center">
        <span
          className="font-display text-3xl font-extrabold uppercase tracking-wide"
          style={{ fontStretch: "125%" }}
        >
          Numa<span className="text-accent">·</span>Radio
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Operator Dashboard · scaffolding…
        </p>
      </div>
    </main>
  );
}
```

### Task 1.6: Copy env + gitignore the right things

**Files:**
- Create: `dashboard/.env.local` (gitignored)
- Modify: `/home/marku/saas/numaradio/.gitignore` (ignore `dashboard/.next`, `dashboard/node_modules`, `dashboard/.env.local`)

- [ ] **Step 1: Copy the parent `.env.local` into the dashboard**

Run:
```bash
cp /home/marku/saas/numaradio/.env.local /home/marku/saas/numaradio/dashboard/.env.local
```

- [ ] **Step 2: Append the one extra var the dashboard needs**

Run:
```bash
cat >> /home/marku/saas/numaradio/dashboard/.env.local <<'EOF'

# Dashboard-specific
CLOUDFLARED_METRICS_URL=http://127.0.0.1:20241/metrics
ICECAST_STATUS_URL=http://localhost:8000/status-json.xsl
STREAM_PUBLIC_URL=https://api.numaradio.com/stream
EOF
```

- [ ] **Step 3: Update the repo's root `.gitignore` so dashboard build artefacts don't get committed**

Add these lines at the end of `/home/marku/saas/numaradio/.gitignore`:
```
# Dashboard build artefacts
/dashboard/.next/
/dashboard/node_modules/
/dashboard/next-env.d.ts
```

(The existing `.env*` rule already covers `dashboard/.env.local`.)

### Task 1.7: First boot — verify locally

- [ ] **Step 1: Start the dev server**

Run in one terminal: `cd /home/marku/saas/numaradio/dashboard && npm run dev`
Expected: `▲ Next.js 16.2.4` ... `Local: http://localhost:3001`

- [ ] **Step 2: Smoke-test from another terminal**

Run: `curl -s http://localhost:3001 | grep -c "Operator Dashboard"`
Expected: `1` (the placeholder page rendered once).

### Task 1.8: End-to-end verify through Cloudflare Access

- [ ] **Step 1: Open `https://dashboard.numaradio.com` in a browser (phone or desktop)**

Expected: Cloudflare Access login page (email + PIN flow). Complete it.

- [ ] **Step 2: After login, you should see the scaffolding page**

Expected: "NUMA·RADIO / Operator Dashboard · scaffolding…" rendered with the dark bg + teal accent. **No** 502, **no** 404.

If you get 502: the dev server isn't running. Make sure Task 1.7 step 1 is still live in its terminal.

### Task 1.9: Commit Phase 1

- [ ] **Step 1: Stop the dev server (Ctrl-C)**

- [ ] **Step 2: Commit**

```bash
cd /home/marku/saas/numaradio
git add .gitignore dashboard/
git commit -m "dashboard: scaffold Next.js 16 app on :3001, mirror parent design tokens"
```

---

## Phase 2 — shadcn/ui foundation

Endpoint: base shadcn components in `components/ui/` plus toast (sonner) wired up. The placeholder page picks up polished look & feel.

### Task 2.1: Initialize shadcn

- [ ] **Step 1: Run shadcn init**

Run: `cd /home/marku/saas/numaradio/dashboard && npx shadcn@latest init --yes --force`

When prompted:
- Style: **New York**
- Base color: **Neutral** (we override with our own tokens anyway)

This creates `components.json` and sets up `lib/utils.ts`, `components/ui/` dir structure.

- [ ] **Step 2: Verify `components.json` exists**

Run: `cat dashboard/components.json | head -3`
Expected: starts with `{`

### Task 2.2: Add the specific shadcn components we need

- [ ] **Step 1: Install the five components**

Run:
```bash
cd /home/marku/saas/numaradio/dashboard
npx shadcn@latest add button card badge dialog --yes
```

Expected: files appear under `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/badge.tsx`, `components/ui/dialog.tsx`.

- [ ] **Step 2: Install sonner (toast) — it's an npm dep, not shadcn-copied**

Sonner was already added in package.json. Confirm it's installed:
Run: `ls node_modules/sonner/package.json`
Expected: file exists.

### Task 2.3: Mount `<Toaster />` in the root layout

**Files:**
- Modify: `dashboard/app/layout.tsx`

- [ ] **Step 1: Add the Toaster import + mount at the bottom of `<body>`**

Replace the `<body>...` line with:
```tsx
import { Toaster } from "sonner";
// ...existing imports above

// inside <body>:
<body className="min-h-full flex flex-col">
  {children}
  <Toaster theme="dark" position="bottom-right" />
</body>
```

- [ ] **Step 2: Verify it compiles**

Restart `npm run dev`, reload the page. No visual change expected (toaster is invisible with no toasts), but the terminal must have no compile errors.

### Task 2.4: Commit Phase 2

- [ ] **Step 1: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/
git commit -m "dashboard: init shadcn/ui (button, card, badge, dialog) + sonner toaster"
```

---

## Phase 3 — Library layer (TDD where it matters)

Endpoint: all data-acquisition modules are written and unit-tested where feasible. No routes or UI yet. You'll be able to `node --test` and see green.

### Task 3.1: `lib/systemd.ts` — input validation (TDD)

**Files:**
- Create: `dashboard/lib/systemd.test.ts`
- Create: `dashboard/lib/systemd.ts`

- [ ] **Step 1: Write the failing test**

`dashboard/lib/systemd.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateServiceAction, type ServiceName, type ServiceAction } from "./systemd";

test("validateServiceAction accepts all whitelisted combos", () => {
  for (const svc of ["icecast2", "numa-liquidsoap", "cloudflared"] as ServiceName[]) {
    for (const act of ["start", "stop", "restart"] as ServiceAction[]) {
      assert.deepEqual(validateServiceAction(svc, act), { name: svc, action: act });
    }
  }
});

test("validateServiceAction rejects non-allowlisted service names", () => {
  assert.throws(() => validateServiceAction("sshd", "restart"), /invalid service/);
  assert.throws(() => validateServiceAction("", "restart"), /invalid service/);
});

test("validateServiceAction rejects shell-injection attempts in service name", () => {
  assert.throws(() => validateServiceAction("icecast2; rm -rf /", "restart"), /invalid service/);
  assert.throws(() => validateServiceAction("icecast2 && curl evil.com", "restart"), /invalid service/);
});

test("validateServiceAction rejects non-allowlisted actions", () => {
  assert.throws(() => validateServiceAction("icecast2", "destroy"), /invalid action/);
  assert.throws(() => validateServiceAction("icecast2", "enable"), /invalid action/);
  assert.throws(() => validateServiceAction("icecast2", ""), /invalid action/);
});
```

- [ ] **Step 2: Run the test, confirm it fails (module doesn't exist yet)**

Run: `cd /home/marku/saas/numaradio/dashboard && npm test -- lib/systemd.test.ts`
Expected: errors because `./systemd` doesn't export anything.

- [ ] **Step 3: Create the minimal implementation**

`dashboard/lib/systemd.ts`:
```ts
export const SERVICE_NAMES = ["icecast2", "numa-liquidsoap", "cloudflared"] as const;
export const SERVICE_ACTIONS = ["start", "stop", "restart"] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

const SERVICES = new Set<string>(SERVICE_NAMES);
const ACTIONS = new Set<string>(SERVICE_ACTIONS);

export function validateServiceAction(
  name: string,
  action: string,
): { name: ServiceName; action: ServiceAction } {
  if (!SERVICES.has(name)) throw new Error(`invalid service: ${JSON.stringify(name)}`);
  if (!ACTIONS.has(action)) throw new Error(`invalid action: ${JSON.stringify(action)}`);
  return { name: name as ServiceName, action: action as ServiceAction };
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm test -- lib/systemd.test.ts`
Expected: `# pass 4`.

### Task 3.2: `lib/systemd.ts` — action runner (spawn + timeout)

**Files:**
- Modify: `dashboard/lib/systemd.ts`

- [ ] **Step 1: Add `runServiceAction` that shells out via spawn**

Append to `dashboard/lib/systemd.ts`:
```ts
import { spawn } from "node:child_process";

export interface ActionResult {
  ok: boolean;
  durationMs: number;
  stderr?: string;
}

export async function runServiceAction(
  name: ServiceName,
  action: ServiceAction,
  timeoutMs = 15_000,
): Promise<ActionResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      "sudo",
      ["-n", "systemctl", action, name],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        durationMs: Date.now() - start,
        stderr: stderr.trim() || undefined,
      });
    });
  });
}
```

- [ ] **Step 2: Manually verify (no test — real sudo/spawn is hard to mock)**

Run (from the dashboard dir):
```bash
node --experimental-strip-types -e '
import("./lib/systemd.ts").then(async (m) => {
  const r = await m.runServiceAction("numa-liquidsoap", "restart");
  console.log(r);
});'
```
Expected: `{ ok: true, durationMs: <~2000> }`. The stream will drop for ~2 s.

### Task 3.3: `lib/systemd.ts` — state + uptime query

**Files:**
- Modify: `dashboard/lib/systemd.ts`

- [ ] **Step 1: Add `getServiceState` that parses `systemctl show`**

Append to `dashboard/lib/systemd.ts`:
```ts
export interface ServiceState {
  name: ServiceName;
  state: "active" | "inactive" | "failed" | "activating" | "deactivating" | "unknown";
  activeSince: string | null; // ISO-8601
  uptimeSec: number | null;
}

export async function getServiceState(name: ServiceName): Promise<ServiceState> {
  return new Promise((resolve) => {
    const child = spawn(
      "systemctl",
      [
        "show",
        name,
        "--property=ActiveState",
        "--property=ActiveEnterTimestamp",
        "--timestamp=unix",
      ],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout?.on("data", (c) => (stdout += c.toString()));
    child.on("close", () => {
      const map = new Map<string, string>();
      for (const line of stdout.split("\n")) {
        const i = line.indexOf("=");
        if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
      }
      const rawState = map.get("ActiveState") ?? "unknown";
      const state: ServiceState["state"] = (
        ["active", "inactive", "failed", "activating", "deactivating"] as const
      ).includes(rawState as never)
        ? (rawState as ServiceState["state"])
        : "unknown";
      // "@1776612765" → 1776612765000
      const ts = map.get("ActiveEnterTimestamp") ?? "";
      const epoch = ts.startsWith("@") ? Number(ts.slice(1)) : NaN;
      const activeSince = Number.isFinite(epoch) && epoch > 0
        ? new Date(epoch * 1000).toISOString()
        : null;
      const uptimeSec = activeSince
        ? Math.max(0, Math.floor((Date.now() - epoch * 1000) / 1000))
        : null;
      resolve({ name, state, activeSince, uptimeSec });
    });
  });
}
```

- [ ] **Step 2: Manually verify**

Run:
```bash
node --experimental-strip-types -e '
import("./lib/systemd.ts").then(async (m) => {
  console.log(await m.getServiceState("icecast2"));
});'
```
Expected: `{ name: "icecast2", state: "active", activeSince: "2026-...", uptimeSec: <large number> }`.

### Task 3.4: `lib/systemd.ts` — journalctl logs tail

**Files:**
- Modify: `dashboard/lib/systemd.ts`

- [ ] **Step 1: Add `tailServiceLogs`**

Append:
```ts
export async function tailServiceLogs(
  name: ServiceName,
  lines: number,
): Promise<{ lines: string[]; error?: string }> {
  const capped = Math.min(Math.max(Math.floor(lines) || 0, 1), 500);
  return new Promise((resolve) => {
    const child = spawn(
      "journalctl",
      ["-u", name, "-n", String(capped), "--no-pager", "-o", "short-iso"],
      { shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => (stdout += c.toString()));
    child.stderr?.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ lines: [], error: stderr.trim() || `exit ${code}` });
        return;
      }
      const out = stdout.split("\n").filter((l) => l.length > 0);
      resolve({ lines: out });
    });
  });
}
```

- [ ] **Step 2: Manually verify**

Run: `node --experimental-strip-types -e 'import("./lib/systemd.ts").then(async m => console.log((await m.tailServiceLogs("numa-liquidsoap", 5)).lines.length))'`
Expected: `5` (or up to 5).

If it prints `0` with an error containing "permission denied" — add `marku` to the `adm` group so journalctl can read:
```bash
sudo usermod -aG adm marku
# Then log out of WSL and back in (close terminal, reopen WSL).
```

### Task 3.5: `lib/icecast.ts` — fetch & parse status-json (TDD with fixture)

**Files:**
- Create: `dashboard/lib/icecast.ts`
- Create: `dashboard/lib/icecast.test.ts`
- Create: `dashboard/lib/__fixtures__/icecast-single-source.json`
- Create: `dashboard/lib/__fixtures__/icecast-no-source.json`
- Create: `dashboard/lib/__fixtures__/icecast-multi-source.json`

- [ ] **Step 1: Capture real fixtures**

Run:
```bash
cd /home/marku/saas/numaradio/dashboard
mkdir -p lib/__fixtures__
curl -s http://localhost:8000/status-json.xsl > lib/__fixtures__/icecast-single-source.json
```

Also create a no-source variant (`lib/__fixtures__/icecast-no-source.json`) — minimal JSON representing "Icecast is up but no source is connected":
```json
{
  "icestats": {
    "admin": "icemaster@localhost",
    "host": "localhost",
    "location": "Earth",
    "server_id": "Icecast 2.4.4",
    "server_start": "Sun, 19 Apr 2026 16:32:45 +0100",
    "server_start_iso8601": "2026-04-19T16:32:45+0100"
  }
}
```

And a multi-source variant (`lib/__fixtures__/icecast-multi-source.json`) — Icecast returns `source` as an **array** when there are multiple mounts:
```json
{
  "icestats": {
    "admin": "icemaster@localhost",
    "host": "localhost",
    "server_id": "Icecast 2.4.4",
    "server_start_iso8601": "2026-04-19T16:32:45+0100",
    "source": [
      {
        "listenurl": "http://localhost:8000/stream",
        "listeners": 2,
        "listener_peak": 5,
        "bitrate": 192,
        "title": "russellross - One More Dance"
      },
      {
        "listenurl": "http://localhost:8000/backup",
        "listeners": 0,
        "listener_peak": 0,
        "bitrate": 128,
        "title": ""
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests**

`dashboard/lib/icecast.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseIcecastStatus } from "./icecast";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"));
}

test("parses single-source Icecast status for /stream", () => {
  const parsed = parseIcecastStatus(fixture("icecast-single-source"), "/stream");
  assert.equal(parsed.mount, "/stream");
  assert.equal(parsed.bitrate, 192);
  assert.equal(typeof parsed.listeners, "number");
  assert.ok(parsed.nowPlaying);
  assert.equal(parsed.nowPlaying?.artist, "russellross");
  assert.equal(parsed.nowPlaying?.title, "One More Dance");
});

test("returns null-mount when no source is connected", () => {
  const parsed = parseIcecastStatus(fixture("icecast-no-source"), "/stream");
  assert.equal(parsed.mount, null);
  assert.equal(parsed.listeners, null);
});

test("picks the right mount when source is an array", () => {
  const parsed = parseIcecastStatus(fixture("icecast-multi-source"), "/stream");
  assert.equal(parsed.mount, "/stream");
  assert.equal(parsed.listeners, 2);
  assert.equal(parsed.bitrate, 192);
  assert.equal(parsed.nowPlaying?.title, "One More Dance");
});

test("empty title returns no nowPlaying", () => {
  const parsed = parseIcecastStatus(fixture("icecast-multi-source"), "/backup");
  assert.equal(parsed.mount, "/backup");
  assert.equal(parsed.nowPlaying, null);
});
```

- [ ] **Step 3: Run, confirm failures**

Run: `npm test -- lib/icecast.test.ts`
Expected: failures because `./icecast` doesn't exist.

- [ ] **Step 4: Implement `lib/icecast.ts`**

```ts
export interface IcecastStatus {
  mount: string | null; // "/stream" when present, null when no source
  listeners: number | null;
  listenerPeak: number | null;
  bitrate: number | null;
  nowPlaying: { artist: string | null; title: string } | null;
}

interface IcecastSource {
  listenurl?: string;
  listeners?: number;
  listener_peak?: number;
  bitrate?: number;
  title?: string;
}

function mountFromListenUrl(listenurl: string | undefined): string | null {
  if (!listenurl) return null;
  try {
    const u = new URL(listenurl);
    return u.pathname || null;
  } catch {
    return null;
  }
}

function splitTitle(title: string): { artist: string | null; title: string } | null {
  const t = (title || "").trim();
  if (!t) return null;
  const dashIdx = t.indexOf(" - ");
  if (dashIdx > 0) {
    return { artist: t.slice(0, dashIdx).trim(), title: t.slice(dashIdx + 3).trim() };
  }
  return { artist: null, title: t };
}

export function parseIcecastStatus(raw: unknown, wantMount: string): IcecastStatus {
  const empty: IcecastStatus = {
    mount: null,
    listeners: null,
    listenerPeak: null,
    bitrate: null,
    nowPlaying: null,
  };
  if (!raw || typeof raw !== "object") return empty;
  const icestats = (raw as { icestats?: { source?: IcecastSource | IcecastSource[] } }).icestats;
  const src = icestats?.source;
  if (!src) return empty;
  const sources = Array.isArray(src) ? src : [src];
  const match = sources.find((s) => mountFromListenUrl(s.listenurl) === wantMount);
  if (!match) return empty;
  return {
    mount: wantMount,
    listeners: typeof match.listeners === "number" ? match.listeners : null,
    listenerPeak: typeof match.listener_peak === "number" ? match.listener_peak : null,
    bitrate: typeof match.bitrate === "number" ? match.bitrate : null,
    nowPlaying: splitTitle(match.title ?? ""),
  };
}

export async function fetchIcecastStatus(
  url: string,
  mount: string,
  timeoutMs = 2_000,
): Promise<IcecastStatus> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return parseIcecastStatus(json, mount);
  } finally {
    clearTimeout(t);
  }
}
```

- [ ] **Step 5: Run tests, confirm all pass**

Run: `npm test -- lib/icecast.test.ts`
Expected: `# pass 4`.

### Task 3.6: `lib/cloudflared.ts` — parse /metrics

**Files:**
- Create: `dashboard/lib/cloudflared.ts`

- [ ] **Step 1: Implement**

```ts
export interface TunnelHealth {
  ok: boolean;
  connections: number;
  error?: string;
}

export function parseTunnelMetrics(text: string): TunnelHealth {
  // The metric we care about is a single gauge:
  //   cloudflared_tunnel_ha_connections <N>
  // (Comments start with # HELP / # TYPE and must be ignored.)
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^cloudflared_tunnel_ha_connections\s+(\d+)/);
    if (m) {
      const n = Number(m[1]);
      return { ok: n > 0, connections: n };
    }
  }
  return { ok: false, connections: 0, error: "metric cloudflared_tunnel_ha_connections not found" };
}

export async function fetchTunnelHealth(
  url: string,
  timeoutMs = 2_000,
): Promise<TunnelHealth> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return { ok: false, connections: 0, error: `HTTP ${res.status}` };
    const text = await res.text();
    return parseTunnelMetrics(text);
  } catch (e) {
    return {
      ok: false,
      connections: 0,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  } finally {
    clearTimeout(t);
  }
}
```

- [ ] **Step 2: Manually verify**

Run: `node --experimental-strip-types -e 'import("./lib/cloudflared.ts").then(async m => console.log(await m.fetchTunnelHealth("http://127.0.0.1:20241/metrics")))'`
Expected: `{ ok: true, connections: 4 }` (or some small positive number).

### Task 3.7: `lib/db.ts` — pg pool

**Files:**
- Create: `dashboard/lib/db.ts`

- [ ] **Step 1: Implement**

```ts
import { Pool } from "pg";

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  pool = new Pool({
    connectionString: url,
    // Small cap; dashboard makes at most ~1 req/5s from 1 client.
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });
  return pool;
}
```

### Task 3.8: `lib/health.ts` — Neon + B2 probes

**Files:**
- Create: `dashboard/lib/health.ts`

- [ ] **Step 1: Implement**

```ts
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getDbPool } from "./db";

export interface HealthPing {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export async function checkNeon(timeoutMs = 2_000): Promise<HealthPing> {
  const start = Date.now();
  try {
    const pool = getDbPool();
    const res = await Promise.race<Promise<HealthPing | null>>([
      pool.query("SELECT 1 AS ok").then(() => ({ ok: true, latencyMs: Date.now() - start })),
      new Promise<HealthPing>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: `timeout after ${timeoutMs}ms` }), timeoutMs),
      ),
    ]);
    return res ?? { ok: false, error: "unknown" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "query failed" };
  }
}

let s3: S3Client | null = null;
function getS3(): S3Client {
  if (s3) return s3;
  s3 = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return s3;
}

export async function checkB2(timeoutMs = 2_000): Promise<HealthPing> {
  const start = Date.now();
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket) return { ok: false, error: "B2_BUCKET_NAME not set" };
  try {
    const cmd = new HeadObjectCommand({ Bucket: bucket, Key: "healthcheck.txt" });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      await getS3().send(cmd, { abortSignal: ctl.signal });
      return { ok: true, latencyMs: Date.now() - start };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // A 404 from a missing key still proves B2 is reachable; 403/500/timeout = not.
    const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode;
    if (status === 404) return { ok: true, latencyMs: Date.now() - start };
    return { ok: false, error: err.name ?? err.Code ?? "unknown" };
  }
}
```

- [ ] **Step 2: Manually verify**

Run:
```bash
cd /home/marku/saas/numaradio/dashboard
node --experimental-strip-types -e '
import("./lib/health.ts").then(async (m) => {
  console.log("neon:", await m.checkNeon());
  console.log("b2:", await m.checkB2());
});'
```
Expected:
- `neon: { ok: true, latencyMs: <20-200> }`
- `b2: { ok: true, latencyMs: <50-500> }` (the missing `healthcheck.txt` is fine — 404 is a positive signal that B2 reachability works).

### Task 3.9: Commit Phase 3

- [ ] **Step 1: Run all tests one more time**

Run: `cd /home/marku/saas/numaradio/dashboard && npm test`
Expected: all green.

- [ ] **Step 2: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/
git commit -m "dashboard: library layer (systemd, icecast, cloudflared, health, db) with unit tests"
```

---

## Phase 4 — API routes

Endpoint: you can `curl http://localhost:3001/api/status` and see a real JSON snapshot of the whole stack. `POST /api/services/...` actually restarts services. `GET /api/logs/...` tails journalctl.

### Task 4.1: `GET /api/status` — aggregator

**Files:**
- Create: `dashboard/app/api/status/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import {
  SERVICE_NAMES,
  getServiceState,
  type ServiceState,
} from "@/lib/systemd";
import { fetchIcecastStatus } from "@/lib/icecast";
import { fetchTunnelHealth } from "@/lib/cloudflared";
import { checkNeon, checkB2, type HealthPing } from "@/lib/health";

export const dynamic = "force-dynamic";

interface StreamSnapshot {
  publicUrl: string;
  reachable: boolean;
  listeners: number | null;
  listenerPeak: number | null;
  bitrate: number | null;
  nowPlaying: { artist: string | null; title: string } | null;
  error?: string;
}

async function probeStreamReachable(url: string, timeoutMs = 2_000): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // Request only the first byte so we don't pull full audio.
    const res = await fetch(url, { headers: { Range: "bytes=0-1" }, signal: ctl.signal });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function streamSnapshot(): Promise<StreamSnapshot> {
  const publicUrl = process.env.STREAM_PUBLIC_URL ?? "https://api.numaradio.com/stream";
  const icecastUrl = process.env.ICECAST_STATUS_URL ?? "http://localhost:8000/status-json.xsl";
  const [reachable, icecast] = await Promise.allSettled([
    probeStreamReachable(publicUrl),
    fetchIcecastStatus(icecastUrl, "/stream"),
  ]);
  const ok = reachable.status === "fulfilled" ? reachable.value : false;
  if (icecast.status === "fulfilled") {
    const s = icecast.value;
    return {
      publicUrl,
      reachable: ok,
      listeners: s.listeners,
      listenerPeak: s.listenerPeak,
      bitrate: s.bitrate,
      nowPlaying: s.nowPlaying,
    };
  }
  return {
    publicUrl,
    reachable: ok,
    listeners: null,
    listenerPeak: null,
    bitrate: null,
    nowPlaying: null,
    error: icecast.reason instanceof Error ? icecast.reason.message : "icecast probe failed",
  };
}

export async function GET(): Promise<NextResponse> {
  const metricsUrl = process.env.CLOUDFLARED_METRICS_URL ?? "http://127.0.0.1:20241/metrics";
  const [stream, services, neon, b2, tunnel] = await Promise.all([
    streamSnapshot(),
    Promise.all(SERVICE_NAMES.map((n) => getServiceState(n))) as Promise<ServiceState[]>,
    checkNeon(),
    checkB2(),
    fetchTunnelHealth(metricsUrl),
  ]);
  return NextResponse.json(
    {
      ts: new Date().toISOString(),
      stream,
      services,
      health: { neon, b2, tunnel } as { neon: HealthPing; b2: HealthPing; tunnel: unknown },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

- [ ] **Step 2: Verify with curl**

Start dev server (`npm run dev`). In another terminal:
Run: `curl -s http://localhost:3001/api/status | python3 -m json.tool | head -30`
Expected: JSON with `ts`, `stream.reachable: true`, `services` array of 3 with `state: "active"`, `health.*.ok: true`.

### Task 4.2: `POST /api/services/[name]/[action]` — action route

**Files:**
- Create: `dashboard/app/api/services/[name]/[action]/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import {
  validateServiceAction,
  runServiceAction,
  getServiceState,
} from "@/lib/systemd";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ name: string; action: string }> },
): Promise<NextResponse> {
  const { name: rawName, action: rawAction } = await ctx.params;
  let validated;
  try {
    validated = validateServiceAction(rawName, rawAction);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "invalid input" },
      { status: 400 },
    );
  }
  const result = await runServiceAction(validated.name, validated.action);
  const post = await getServiceState(validated.name);
  // Audit log — captured by journalctl once dashboard is a systemd service.
  const user = req.headers.get("cf-access-authenticated-user-email") ?? "unknown";
  console.info(
    `action=${validated.action} service=${validated.name} user=${user} ok=${result.ok} duration=${result.durationMs}ms`,
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.stderr ?? "action failed", state: post.state, durationMs: result.durationMs },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    state: post.state,
    durationMs: result.durationMs,
  });
}
```

- [ ] **Step 2: Verify with curl**

Run: `curl -s -X POST http://localhost:3001/api/services/numa-liquidsoap/restart | python3 -m json.tool`
Expected: `{ "ok": true, "state": "active", "durationMs": <~2000> }`. The stream will drop for ~2 s.

Also try an invalid action:
Run: `curl -s -X POST http://localhost:3001/api/services/sshd/restart`
Expected: `{"ok":false,"error":"invalid service: \"sshd\""}` with HTTP 400.

### Task 4.3: `GET /api/logs/[name]` — journalctl tail

**Files:**
- Create: `dashboard/app/api/logs/[name]/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { SERVICE_NAMES, tailServiceLogs, type ServiceName } from "@/lib/systemd";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await ctx.params;
  if (!SERVICE_NAMES.includes(name as ServiceName)) {
    return NextResponse.json({ ok: false, error: "invalid service" }, { status: 400 });
  }
  const url = new URL(req.url);
  const linesParam = Number(url.searchParams.get("lines") ?? "50");
  const { lines, error } = await tailServiceLogs(name as ServiceName, linesParam);
  return NextResponse.json(
    { name, lines, error },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

- [ ] **Step 2: Verify with curl**

Run: `curl -s 'http://localhost:3001/api/logs/numa-liquidsoap?lines=5' | python3 -m json.tool`
Expected: JSON with `name` and a `lines` array of up to 5 short-iso-formatted strings.

If `lines` is empty with an error about permission denied: run the usermod command from Task 3.4 step 2.

### Task 4.4: Commit Phase 4

- [ ] **Step 1: Stop the dev server**

- [ ] **Step 2: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/
git commit -m "dashboard: API routes — aggregated /api/status, service actions, log tail"
```

---

## Phase 5 — UI components

Endpoint: the real dashboard UI at `https://dashboard.numaradio.com`. Four cards, polling, restart button works.

### Task 5.1: `hooks/use-polling.ts`

**Files:**
- Create: `dashboard/hooks/use-polling.ts`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UsePollingResult<T> {
  data: T | null;
  error: string | null;
  lastUpdated: number | null;
  isStale: boolean;
  refresh: () => void;
}

export function usePolling<T>(
  url: string,
  intervalMs: number,
  enabled = true,
): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      setData(json);
      setError(null);
      setIsStale(false);
      setLastUpdated(Date.now());
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "fetch failed");
      setIsStale(true);
    }
  }, [url]);

  useEffect(() => {
    if (!enabled) return;
    fetchOnce();
    const id = setInterval(fetchOnce, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") fetchOnce();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
    };
  }, [enabled, fetchOnce, intervalMs]);

  return { data, error, lastUpdated, isStale, refresh: fetchOnce };
}
```

### Task 5.2: Shared type module

**Files:**
- Create: `dashboard/lib/types.ts`

- [ ] **Step 1: Define the API-shape types so UI + route agree**

```ts
import type { ServiceName } from "./systemd";

export interface StatusSnapshot {
  ts: string;
  stream: {
    publicUrl: string;
    reachable: boolean;
    listeners: number | null;
    listenerPeak: number | null;
    bitrate: number | null;
    nowPlaying: { artist: string | null; title: string } | null;
    error?: string;
  };
  services: {
    name: ServiceName;
    state: "active" | "inactive" | "failed" | "activating" | "deactivating" | "unknown";
    activeSince: string | null;
    uptimeSec: number | null;
  }[];
  health: {
    neon: { ok: boolean; latencyMs?: number; error?: string };
    b2: { ok: boolean; latencyMs?: number; error?: string };
    tunnel: { ok: boolean; connections: number; error?: string };
  };
}
```

### Task 5.3: `components/status-pills.tsx`

**Files:**
- Create: `dashboard/components/status-pills.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import type { StatusSnapshot } from "@/lib/types";

interface Props {
  data: StatusSnapshot | null;
  isStale: boolean;
}

export function StatusPills({ data, isStale }: Props) {
  const live = data?.stream.reachable ?? false;
  const listeners = data?.stream.listeners ?? null;
  const peak = data?.stream.listenerPeak ?? null;
  const np = data?.stream.nowPlaying;
  return (
    <section className="flex flex-col md:flex-row gap-4 items-start md:items-center">
      <div
        className={`inline-flex items-center gap-3 rounded-full border px-4 py-2 text-sm font-medium ${
          live
            ? "border-accent text-accent bg-[var(--accent-soft)]"
            : "border-[var(--bad)] text-[var(--bad)]"
        } ${isStale ? "opacity-60" : ""}`}
      >
        <span
          className={`h-2 w-2 rounded-full ${live ? "bg-accent" : "bg-[var(--bad)]"}`}
          style={live ? { animation: "numa-pulse 2.2s ease-in-out infinite" } : undefined}
        />
        {live ? "Stream is live" : "Stream is down"}
      </div>
      <div className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
        {listeners !== null ? `${listeners} listener${listeners === 1 ? "" : "s"}` : "— listeners"}
        {peak !== null ? <span className="ml-2 opacity-60">peak {peak}</span> : null}
      </div>
      <div className="text-sm text-fg-dim">
        {np ? (
          <>
            Now playing:{" "}
            <span className="text-fg">
              {np.artist ? `${np.artist} — ` : ""}
              {np.title}
            </span>
          </>
        ) : (
          <span className="text-fg-mute">No title metadata.</span>
        )}
      </div>
    </section>
  );
}
```

### Task 5.4: `components/service-row.tsx` + `services-card.tsx`

**Files:**
- Create: `dashboard/components/service-row.tsx`
- Create: `dashboard/components/services-card.tsx`

- [ ] **Step 1: `service-row.tsx`**

```tsx
"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { StatusSnapshot } from "@/lib/types";

type Service = StatusSnapshot["services"][number];

function fmtUptime(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

interface Props {
  svc: Service;
  onActionComplete: () => void;
}

export function ServiceRow({ svc, onActionComplete }: Props) {
  const [pending, setPending] = useState<null | "start" | "stop" | "restart">(null);

  async function run(action: "start" | "stop" | "restart") {
    setPending(action);
    try {
      const res = await fetch(`/api/services/${svc.name}/${action}`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string; state?: string; durationMs?: number };
      if (res.ok && json.ok) {
        toast.success(
          `${action}ed ${svc.name}${json.state ? ` (${json.state}` : ""}${
            json.durationMs ? ` in ${(json.durationMs / 1000).toFixed(1)}s)` : ")"
          }`,
        );
        onActionComplete();
      } else {
        toast.error(`Failed to ${action} ${svc.name}`, { description: json.error ?? "unknown error" });
      }
    } catch (e) {
      toast.error(`Failed to ${action} ${svc.name}`, {
        description: e instanceof Error ? e.message : "network error",
      });
    } finally {
      setPending(null);
    }
  }

  const stateColor =
    svc.state === "active"
      ? "border-accent text-accent bg-[var(--accent-soft)]"
      : svc.state === "activating" || svc.state === "deactivating"
        ? "border-[var(--warn)] text-[var(--warn)]"
        : "border-[var(--bad)] text-[var(--bad)]";

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line last:border-0">
      <div className="flex flex-col">
        <span className="font-mono text-sm">{svc.name}</span>
        <span className="text-xs text-fg-mute">uptime {fmtUptime(svc.uptimeSec)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={stateColor}>
          {svc.state}
        </Badge>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!pending || svc.state === "active"}
          onClick={() => run("start")}
        >
          {pending === "start" ? "…" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!pending || svc.state === "inactive" || svc.state === "failed"}
          onClick={() => run("stop")}
        >
          {pending === "stop" ? "…" : "Stop"}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="secondary" disabled={!!pending}>
              {pending === "restart" ? "…" : "Restart"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restart {svc.name}?</DialogTitle>
              <DialogDescription>
                The stream may drop for a few seconds while this service restarts.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Cancel</Button>
              <Button onClick={() => run("restart")}>Confirm restart</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `services-card.tsx`**

```tsx
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatusSnapshot } from "@/lib/types";
import { ServiceRow } from "./service-row";

interface Props {
  data: StatusSnapshot | null;
  onActionComplete: () => void;
}

export function ServicesCard({ data, onActionComplete }: Props) {
  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader>
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Services
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data?.services.map((svc) => (
          <ServiceRow key={svc.name} svc={svc} onActionComplete={onActionComplete} />
        )) ?? <div className="px-4 py-6 text-sm text-fg-mute">Loading…</div>}
      </CardContent>
    </Card>
  );
}
```

### Task 5.5: `components/health-card.tsx`

**Files:**
- Create: `dashboard/components/health-card.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatusSnapshot } from "@/lib/types";

interface Props {
  data: StatusSnapshot | null;
}

function Row({
  label,
  ok,
  detail,
  error,
}: {
  label: string;
  ok: boolean | undefined;
  detail?: string;
  error?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-line last:border-0">
      <span className="font-mono text-sm">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-accent" : ok === false ? "bg-[var(--bad)]" : "bg-fg-mute"}`}
        />
        <span className="text-xs text-fg-dim" title={error ?? undefined}>
          {ok === undefined ? "—" : ok ? (detail ?? "OK") : (error ?? "fail")}
        </span>
      </span>
    </div>
  );
}

export function HealthCard({ data }: Props) {
  const h = data?.health;
  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader>
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Health
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Row
          label="Neon Postgres"
          ok={h?.neon.ok}
          detail={h?.neon.latencyMs !== undefined ? `${h.neon.latencyMs} ms` : undefined}
          error={h?.neon.error}
        />
        <Row
          label="Backblaze B2"
          ok={h?.b2.ok}
          detail={h?.b2.latencyMs !== undefined ? `${h.b2.latencyMs} ms` : undefined}
          error={h?.b2.error}
        />
        <Row
          label="Cloudflare Tunnel"
          ok={h?.tunnel.ok}
          detail={h ? `${h.tunnel.connections} conn` : undefined}
          error={h?.tunnel.error}
        />
      </CardContent>
    </Card>
  );
}
```

### Task 5.6: `components/logs-card.tsx`

**Files:**
- Create: `dashboard/components/logs-card.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SERVICE_NAMES, type ServiceName } from "@/lib/systemd";

interface LogsResponse {
  name: string;
  lines: string[];
  error?: string;
}

export function LogsCard() {
  const [active, setActive] = useState<ServiceName | null>(null);
  const [data, setData] = useState<LogsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await fetch(`/api/logs/${active}?lines=50`, {
          signal: ctl.signal,
          cache: "no-store",
        });
        const json = (await res.json()) as LogsResponse;
        setData(json);
        setErr(json.error ?? null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setErr(e instanceof Error ? e.message : "fetch failed");
      }
    };
    load();
    const id = setInterval(load, 5_000);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [active]);

  return (
    <Card className="bg-bg-1 border-line">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Logs
        </CardTitle>
        <div className="flex gap-1">
          {SERVICE_NAMES.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={active === name ? "default" : "outline"}
              onClick={() => setActive(active === name ? null : name)}
              className="font-mono text-xs"
            >
              {name}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {active === null ? (
          <p className="text-sm text-fg-mute">Pick a service to tail its logs. Polling pauses when no service is selected.</p>
        ) : err ? (
          <p className="text-sm text-[var(--bad)]">Error: {err}</p>
        ) : (
          <pre className="font-mono text-xs text-fg-dim overflow-x-auto max-h-64 whitespace-pre-wrap">
            {data?.lines.join("\n") ?? "Loading…"}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
```

### Task 5.7: Wire it all up in `app/page.tsx`

**Files:**
- Modify: `dashboard/app/page.tsx`

- [ ] **Step 1: Replace placeholder with the real dashboard**

```tsx
"use client";
import { usePolling } from "@/hooks/use-polling";
import { StatusPills } from "@/components/status-pills";
import { ServicesCard } from "@/components/services-card";
import { HealthCard } from "@/components/health-card";
import { LogsCard } from "@/components/logs-card";
import type { StatusSnapshot } from "@/lib/types";

export default function OperatorDashboard() {
  const { data, isStale, refresh } = usePolling<StatusSnapshot>("/api/status", 5_000);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <span
          className="font-display text-2xl font-extrabold uppercase tracking-wide"
          style={{ fontStretch: "125%" }}
        >
          Numa<span className="text-accent">·</span>Radio
        </span>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-mute">
          Operator · polling every 5s {isStale ? "· ⚠ stale, retrying" : ""}
        </span>
      </header>

      <StatusPills data={data} isStale={isStale} />
      <ServicesCard data={data} onActionComplete={refresh} />
      <HealthCard data={data} />
      <LogsCard />
    </main>
  );
}
```

- [ ] **Step 2: Reload the browser — whole dashboard should render**

Open `https://dashboard.numaradio.com`. Expected:
- Header with "NUMA·RADIO / Operator · polling every 5s"
- Green "Stream is live" pill with listener count + now-playing
- Services card with 3 rows, all green "active", uptime visible
- Buttons work (try "Restart" → confirm dialog → click Confirm → toast)
- Health card with 3 green rows
- Logs card — click `numa-liquidsoap` → tail appears

### Task 5.8: Commit Phase 5

- [ ] **Step 1: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/
git commit -m "dashboard: UI cards (status, services, health, logs) + 5s polling hook"
```

---

## Phase 6 — Integration smoke + manual acceptance

### Task 6.1: `scripts/smoke.ts`

**Files:**
- Create: `dashboard/scripts/smoke.ts`

- [ ] **Step 1: Implement**

```ts
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3099;

async function waitForReady(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* keep trying */
    }
    await sleep(500);
  }
  throw new Error(`server never became ready at ${url}`);
}

async function main() {
  const child = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: false,
  });
  try {
    await waitForReady(`http://localhost:${PORT}`);
    const res = await fetch(`http://localhost:${PORT}/api/status`);
    if (!res.ok) throw new Error(`/api/status returned ${res.status}`);
    const json = (await res.json()) as {
      ts: string;
      stream: { reachable: boolean };
      services: { state: string }[];
      health: { neon: { ok: boolean }; b2: { ok: boolean }; tunnel: { ok: boolean } };
    };
    if (!json.ts) throw new Error("missing ts");
    if (!json.stream.reachable) throw new Error("stream not reachable — is the broadcast stack running?");
    if (json.services.length !== 3) throw new Error(`expected 3 services, got ${json.services.length}`);
    for (const s of json.services) {
      if (s.state !== "active") throw new Error(`service not active: ${JSON.stringify(s)}`);
    }
    if (!json.health.neon.ok) throw new Error("neon not ok");
    if (!json.health.b2.ok) throw new Error("b2 not ok");
    if (!json.health.tunnel.ok) throw new Error("tunnel not ok");
    console.log("✓ smoke passed");
  } finally {
    child.kill("SIGINT");
  }
}

main().catch((e) => {
  console.error("✗ smoke failed:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `cd /home/marku/saas/numaradio/dashboard && npm run smoke`
Expected: `✓ smoke passed`.

### Task 6.2: `ACCEPTANCE.md`

**Files:**
- Create: `dashboard/ACCEPTANCE.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Operator Dashboard — Acceptance Checklist

Run after any substantive change to the dashboard.

- [ ] `https://dashboard.numaradio.com` shows Cloudflare Access login on a fresh device (incognito)
- [ ] Signing in with an allowlisted email lands on the dashboard
- [ ] Top pill shows "Stream is live" (green pulse) when stream is up
- [ ] Listener count increments when I open `https://api.numaradio.com/stream` in a second tab
- [ ] Now playing shows correct title + artist ("Russell Ross — One More Dance" style)
- [ ] All 3 service rows (icecast2, numa-liquidsoap, cloudflared) show "active" with an uptime
- [ ] Health card shows Neon + B2 + Tunnel all green
- [ ] Logs card: click numa-liquidsoap → last 50 lines appear
- [ ] Click Restart on numa-liquidsoap → confirmation dialog → Confirm → success toast
- [ ] During restart, service row briefly shows "activating" then "active"
- [ ] Externally `sudo systemctl stop icecast2` → Icecast row goes red within ~5s
- [ ] Externally `sudo systemctl start icecast2` → recovers within ~5s
- [ ] Open dashboard on phone — all cards stack vertically and work
- [ ] Background the tab for 1 min → DevTools Network tab shows no requests during hidden time
- [ ] Return to tab → immediate fetch visible in Network tab (not waiting for 5s cadence)
```

### Task 6.3: Walk through the acceptance checklist

- [ ] **Step 1: Check off every box manually.**

Fix anything that doesn't match. Likely hiccups:
- **Tunnel row red** despite services being up: cloudflared was restarted (Phase 0 Task 0.2.3), give it ~10 s to reconnect.
- **Logs empty with permission error:** `sudo usermod -aG adm marku`, log out of WSL (`exit`), reopen terminal.
- **Restart button disabled:** it's disabled while an action is pending; wait a couple seconds.

### Task 6.4: Commit Phase 6

- [ ] **Step 1: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/
git commit -m "dashboard: smoke test + acceptance checklist"
```

---

## Phase 7 — Production systemd service

Endpoint: dashboard runs as a proper systemd service, survives WSL restart, serves built output (not dev mode).

### Task 7.1: Production build

- [ ] **Step 1: Build**

Run: `cd /home/marku/saas/numaradio/dashboard && npm run build`
Expected: `✓ Compiled successfully`, route summary listed.

- [ ] **Step 2: Smoke-test the production server locally**

Run: `npm run start &` — wait 2 s — `curl -s http://localhost:3001/api/status | head -c 100`
Expected: JSON. Then `kill %1` to stop it.

### Task 7.2: Create `/etc/systemd/system/numa-dashboard.service`

**Files:**
- Create (via sudo): `/etc/systemd/system/numa-dashboard.service`
- Create (in repo): `dashboard/deploy/numa-dashboard.service` (reference copy)

- [ ] **Step 1: Write the reference copy in-repo**

Create `dashboard/deploy/numa-dashboard.service`:
```ini
[Unit]
Description=Numa Radio — Operator Dashboard (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=marku
WorkingDirectory=/home/marku/saas/numaradio/dashboard
EnvironmentFile=/home/marku/saas/numaradio/dashboard/.env.local
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=numa-dashboard

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Install it**

Run:
```bash
sudo cp /home/marku/saas/numaradio/dashboard/deploy/numa-dashboard.service /etc/systemd/system/numa-dashboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now numa-dashboard
sleep 3
systemctl is-active numa-dashboard
```
Expected: `active`.

- [ ] **Step 3: Verify public URL still works**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -L https://dashboard.numaradio.com`
Expected: `200` (Cloudflare Access login — you're already authenticated) or redirects to the dashboard.

Open `https://dashboard.numaradio.com` in your browser — it should still work exactly like Phase 5 left it.

### Task 7.3: Update `docs/HANDOFF.md`

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add a new section under "Where we are" noting the dashboard is live**

Append under the Phase 1 section in `docs/HANDOFF.md`:
```markdown

**Phase 2 (Operator Dashboard) — DONE**
- ✅ `https://dashboard.numaradio.com` live behind Cloudflare Access
- ✅ Next.js dashboard on WSL2 mini-server, port 3001
- ✅ Services (icecast2, numa-liquidsoap, cloudflared): 1-click start/stop/restart via narrow sudoers allowlist
- ✅ Live status cards: stream, services, Neon + B2 + tunnel health, journalctl tails
- Design spec: `docs/superpowers/specs/2026-04-19-operator-dashboard-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-19-operator-dashboard.md`
```

### Task 7.4: Final commit

- [ ] **Step 1: Commit**

```bash
cd /home/marku/saas/numaradio
git add dashboard/deploy/ docs/HANDOFF.md
git commit -m "dashboard: production systemd service + update HANDOFF"
```

- [ ] **Step 2: Push**

```bash
git push origin main
```

(This will trigger a Vercel deploy, which won't touch the dashboard code — Vercel only builds the parent app's landing page. The dashboard runs exclusively on the mini-server.)

---

## Self-review — did we cover the spec?

Every spec section mapped to tasks:

| Spec section | Covered by |
|---|---|
| §2 decisions 1 (hostname + Access) | Phase 0 Tasks 0.2, 0.3 |
| §2 decision 2 (sudoers) | Phase 0 Task 0.1 |
| §2 decision 3 (v1 scope) | Phase 5 Tasks 5.3–5.6 |
| §2 decision 4 (5s polling + visibility pause) | Phase 5 Task 5.1 |
| §2 decision 5 (repo layout) | Phase 1 Tasks 1.1–1.6 |
| §2 decision 6 (shadcn) | Phase 2 |
| §3 architecture | Phase 0 + Phase 1 |
| §4 file layout | Phases 1, 3, 4, 5 |
| §5.1 GET /api/status shape | Phase 4 Task 4.1 |
| §5.2 POST /api/services input-validation + audit log | Phase 4 Task 4.2 |
| §5.3 GET /api/logs | Phase 4 Task 4.3 |
| §5.4 polling loop + visibility pause | Phase 5 Task 5.1 |
| §5.5 click-to-restart flow | Phase 5 Task 5.4 (ServiceRow) |
| §6 partial-failure tolerance | Phase 4 Task 4.1 (Promise.all + streamSnapshot swallows errors per-field) |
| §6 error-matrix UI behaviors | Phase 5 Tasks 5.3–5.6 |
| §7.1 unit tests | Phase 3 Tasks 3.1, 3.5 |
| §7.2 integration smoke | Phase 6 Task 6.1 |
| §7.3 manual acceptance | Phase 6 Tasks 6.2, 6.3 |
| §8 sudoers + cloudflared ingress + DNS + systemd | Phase 0 Tasks 0.1, 0.2; Phase 7 Task 7.2 |
| §9 explicit out-of-scope | Not implemented, by design |

No gaps.
