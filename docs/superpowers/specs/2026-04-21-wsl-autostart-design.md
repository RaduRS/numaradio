# WSL auto-start on Windows boot — Design

**Date:** 2026-04-21
**Context:** On 2026-04-21 at 02:19:56 BST, Orion (the WSL2 host) BSOD'd
(bugcheck `0x0000000A IRQL_NOT_LESS_OR_EQUAL`) and Windows auto-rebooted at
02:31. The Numa Radio stack stayed offline until 07:47 — ~5h 27m of dead air —
because the existing `Start WSL (Numa Radio)` scheduled task fires on user
logon, not on system startup.

## Goal

After any unattended Windows reboot or crash-recovery, the Numa Radio stack
(Icecast, Liquidsoap, queue daemon, dashboard, cloudflared tunnel) comes back
on air within ~90 seconds, without a human logging in.

## Non-goals (explicit YAGNI)

- No alert / notification pipeline when the task fails.
- No watchdog for "WSL booted but cloudflared is wedged inside."
- No tweaks to Windows power plan / idle-sleep (user has already set
  lid-close = "Do nothing" on both battery and AC).
- No Windows Update scheduling.

## Current state

Already in place and correct:

- `/etc/wsl.conf` has `[boot] systemd=true` and `[user] default=marku`.
- All five systemd units are `enabled` **and** `active`:
  `icecast2`, `numa-liquidsoap`, `numa-queue-daemon`, `numa-dashboard`,
  `cloudflared`, plus `numa-rotation-refresher.timer`.
- Windows Fast Startup is OFF (`HiberbootEnabled = 0`).
- Scheduled task `Start WSL (Numa Radio)` exists, created by the user.

Broken for the stated goal:

- Task trigger is `MSFT_TaskLogonTrigger` (fires on user logon only).
- Task principal: `LogonType=Interactive`, `RunLevel=Limited` (requires a
  user session).
- `DisallowStartIfOnBatteries=True`, `StopIfGoingOnBatteries=True`.

These three properties together explain exactly why the radio stayed down
after the 02:31 auto-recovery: no user was logged in, so the logon trigger
never fired.

## Design

One Windows scheduled task — the existing one, reconfigured. No changes
inside WSL.

### Activation chain

```
Windows boots
    ↓
Task Scheduler fires "Start WSL (Numa Radio)"  (S4U marku, no session required)
    ↓
wsl.exe -d Ubuntu -u marku -- /bin/true
    ↓
WSL2 VM boots; systemd inside starts all enabled units
    ↓
cloudflared opens api.numaradio.com tunnel → station live
```

### Task configuration (target state)

| Property | Value | Rationale |
|---|---|---|
| `TaskName` | `Start WSL (Numa Radio)` | Reuse existing task. |
| Triggers | **AtStartup** + **AtLogOn(user=ORION\marku)** + **OnSessionStateChange(SessionUnlock, user=ORION\marku)** | Unattended boot recovery + keep existing interactive warm-up + kick WSL after sleep-resume (unlock fires when the user wakes the machine). |
| `Principal.UserId` | `ORION\marku` | WSL distros are per-user; only marku can launch the Ubuntu distro. |
| `Principal.LogonType` | `S4U` | Run without interactive session, no password stored. |
| `Principal.RunLevel` | `Highest` | So WSL can touch Hyper-V and /etc. |
| `Action.Execute` | `wsl.exe` | — |
| `Action.Arguments` | `-d Ubuntu -u marku -- /bin/true` | Two-second no-op that forces the VM to boot. |
| `Settings.DisallowStartIfOnBatteries` | `False` | Radio should recover even if power is briefly lost and laptop is on battery for a moment. |
| `Settings.StopIfGoingOnBatteries` | `False` | Same reason. |
| `Settings.MultipleInstances` | `IgnoreNew` | Avoid pile-up if AtStartup + AtLogOn fire close together. |
| `Settings.RestartOnFailureCount` | `3` | Survive a cold WSL subsystem (e.g., brief wsl.exe error). |
| `Settings.RestartOnFailureInterval` | `PT1M` | — |
| `Settings.ExecutionTimeLimit` | `PT5M` | Action is ~2s; 5min is a generous safety cap (was 72h). |
| `Settings.Hidden` | `False` | Keep visible in the GUI for easy inspection. |

### Why S4U (not Password or SYSTEM)

- **SYSTEM** can't launch a per-user WSL distro; distros are bound to a user.
- **Password** requires caching the Windows password in DPAPI. Breaks on every
  password change.
- **S4U** runs the task as `marku` in a non-interactive token, no password
  stored, no session required. Tradeoff: no network-share access (irrelevant
  for `wsl.exe` on localhost).

## Failure modes

| Failure | Behaviour |
|---|---|
| `wsl.exe` missing or WSL subsystem broken | Task exits non-zero; `RestartCount=3` with 1-min spacing; after 3 failures the task is quiet until next trigger. |
| WSL boots but systemd inside fails | Out of scope — all services stay down. A future watchdog addresses this. |
| cloudflared fails to connect | Out of scope — Icecast is up locally but the public tunnel is dead. Same future watchdog. |
| Multiple triggers fire close together | `MultipleInstances=IgnoreNew` — second invocation no-ops, first one completes. |
| Crash-reboot loop | 3 retries with 1-min gaps contain Task Scheduler side; if Windows itself is looping, this design can't help. |

## Verification

1. **Configuration check (no reboot required):**
   `Get-ScheduledTask -TaskName 'Start WSL (Numa Radio)' | Select-Object -ExpandProperty Triggers`
   — expect three entries: Boot, Logon, SessionStateChange.
   `… | Select-Object -ExpandProperty Principal`
   — expect `LogonType=S4U, RunLevel=Highest`.

2. **Dry run:**
   `Start-ScheduledTask -TaskName 'Start WSL (Numa Radio)'`
   then `Get-ScheduledTaskInfo -TaskName 'Start WSL (Numa Radio)'`
   — expect `LastTaskResult=0`.

3. **Real-world test (user-scheduled):**
   On the next planned reboot, confirm from a *different device* (phone,
   another laptop) that `curl -sI https://api.numaradio.com/stream` returns
   `200 OK` within ~90s of Windows POST, *while Orion is still at the lock
   screen*. Must not require user logon to pass.

## Rollback

If anything misbehaves:

```powershell
Unregister-ScheduledTask -TaskName 'Start WSL (Numa Radio)' -Confirm:$false
# then recreate with the original (logon-only) configuration, captured in
# the implementation plan as a backup XML export.
```

Implementation MUST capture the current task's XML export before modifying,
so rollback is a one-liner `schtasks /create /tn … /xml backup.xml /f`.

## Implementation outline

1. Export current task to XML as backup (`schtasks /query /tn "Start WSL (Numa Radio)" /xml > backup.xml`).
2. Build the new task via `Register-ScheduledTask` (idempotent; will overwrite the existing task of the same name).
3. Run configuration checks (dry run + trigger inspection).
4. Commit the backup XML and a small PowerShell install script to the repo
   under `deploy/windows/` so the config is reproducible on a rebuild.

Full step-by-step will live in the implementation plan.
