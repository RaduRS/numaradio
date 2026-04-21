# WSL auto-start on Windows boot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconfigure the existing Windows scheduled task `Start WSL (Numa Radio)` so WSL boots (and therefore the Numa Radio stack auto-starts) after unattended Windows reboots, without requiring a user logon.

**Architecture:** Pure Windows-side change — replace the task's logon-only trigger with a three-trigger set (Boot + Logon + SessionUnlock), and switch the principal from `Interactive` to `S4U` so the task can run without a user session. WSL itself already has `systemd=true` and all five radio services `enabled`, so kicking the VM is sufficient to bring the station back.

**Tech Stack:** Windows Task Scheduler, PowerShell (`New-ScheduledTask*`), WSL2, `schtasks.exe` for XML backup.

Spec: `docs/superpowers/specs/2026-04-21-wsl-autostart-design.md`

---

## File Structure

Files to create, all under `deploy/windows/`:

| Path | Purpose |
|---|---|
| `deploy/windows/Start-WSL-NumaRadio.backup.xml` | One-time XML export of the current task, committed as a rollback snapshot. |
| `deploy/windows/install-autostart.ps1` | Idempotent installer. Registers the task with the target config. Re-runnable after Windows reinstall / machine rebuild. |

No changes inside the repo's Next.js / Node / Liquidsoap code. No changes inside WSL.

---

## Task 1: Back up the current Windows task

Captures the existing `Start WSL (Numa Radio)` task as XML so we can roll back with one command if anything breaks.

**Files:**
- Create: `deploy/windows/Start-WSL-NumaRadio.backup.xml`

- [ ] **Step 1: Export the current task to XML via Windows**

From the WSL shell, call Windows' `schtasks.exe` to produce the XML, routed to a staging path on the Windows side:

```bash
/mnt/c/Windows/System32/schtasks.exe /query /tn "Start WSL (Numa Radio)" /xml > /tmp/task-backup.xml
# Also drop a copy under Windows Users so both sides can see it
cp /tmp/task-backup.xml /mnt/c/Users/marku/task-backup.xml
```

- [ ] **Step 2: Sanity-check the export**

```bash
head -3 /tmp/task-backup.xml
```

Expected first line: `<?xml version="1.0" encoding="UTF-16"?>` (schtasks emits UTF-16). If the file starts with `ERROR:` or is empty, stop — the task name didn't match.

- [ ] **Step 3: Copy into the repo**

```bash
cp /tmp/task-backup.xml /home/marku/saas/numaradio/deploy/windows/Start-WSL-NumaRadio.backup.xml
```

- [ ] **Step 4: Commit the backup**

```bash
cd /home/marku/saas/numaradio
git add deploy/windows/Start-WSL-NumaRadio.backup.xml
git commit -m "chore(deploy): snapshot Start WSL scheduled task before retarget"
```

---

## Task 2: Write the installer script

One PowerShell script that deletes the old task (if present) and registers the new one with the target configuration from the spec. Idempotent — safe to re-run.

**Files:**
- Create: `deploy/windows/install-autostart.ps1`

- [ ] **Step 1: Author `install-autostart.ps1`**

Contents of `deploy/windows/install-autostart.ps1`:

```powershell
#Requires -RunAsAdministrator
<#
Reconfigures the "Start WSL (Numa Radio)" scheduled task so WSL starts at
Windows boot (not just at user logon), keeping the radio stack reachable
across unattended reboots and crash-recoveries.

Idempotent: unregisters any prior task of the same name and registers fresh.
#>

$ErrorActionPreference = 'Stop'

$taskName = 'Start WSL (Numa Radio)'
$userId   = 'ORION\marku'

# --- Remove any existing version (idempotent) -----------------------------
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# --- Full task build via the Schedule.Service COM API ---------------------
# (The PS CIM cmdlets can't express a SessionStateChange trigger, so we
# build the whole task through COM for uniformity.)
$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()
$root = $service.GetFolder('\')
$task = $service.NewTask(0)

$task.RegistrationInfo.Description = 'Kicks WSL2 so Numa Radio services come back on air after Windows boot / logon / session-unlock.'
$task.RegistrationInfo.Author      = 'numaradio'

# Principal: S4U marku, Highest
$p = $task.Principal
$p.UserId    = $userId
$p.LogonType = 2   # TASK_LOGON_S4U
$p.RunLevel  = 1   # TASK_RUNLEVEL_HIGHEST

# Settings
$s = $task.Settings
$s.Enabled                    = $true
$s.AllowDemandStart           = $true
$s.StartWhenAvailable         = $true
$s.DisallowStartIfOnBatteries = $false
$s.StopIfGoingOnBatteries     = $false
$s.MultipleInstances          = 2        # IgnoreNew
$s.RestartCount               = 3
$s.RestartInterval            = 'PT1M'
$s.ExecutionTimeLimit         = 'PT5M'
$s.Hidden                     = $false
$s.Priority                   = 7

# Trigger 1: At boot
$t1 = $task.Triggers.Create(8)   # TASK_TRIGGER_BOOT
$t1.Enabled = $true

# Trigger 2: At logon (marku only)
$t2 = $task.Triggers.Create(9)   # TASK_TRIGGER_LOGON
$t2.UserId  = $userId
$t2.Enabled = $true

# Trigger 3: At session unlock (marku)
$t3 = $task.Triggers.Create(11)  # TASK_TRIGGER_SESSION_STATE_CHANGE
$t3.StateChange = 8              # SESSION_UNLOCK
$t3.UserId      = $userId
$t3.Enabled     = $true

# Action: kick the Ubuntu distro
$a = $task.Actions.Create(0)     # TASK_ACTION_EXEC
$a.Path      = 'wsl.exe'
$a.Arguments = '-d Ubuntu -u marku -- /bin/true'

# Register (flags: 6 = CREATE_OR_UPDATE, logonType S4U)
$root.RegisterTaskDefinition(
    $taskName,
    $task,
    6,              # TASK_CREATE_OR_UPDATE
    $userId,        # UserId for S4U
    $null,          # no password (S4U)
    2               # TASK_LOGON_S4U
) | Out-Null

Write-Host "Task '$taskName' registered."
Write-Host ""
Write-Host "--- Triggers ---"
Get-ScheduledTask -TaskName $taskName | Select-Object -ExpandProperty Triggers |
  Format-Table -AutoSize @{n='Type';e={$_.CimClass.CimClassName}}, Enabled, StateChange, UserId
Write-Host "--- Principal ---"
Get-ScheduledTask -TaskName $taskName | Select-Object -ExpandProperty Principal |
  Format-List UserId, LogonType, RunLevel
```

Note: the script uses the Schedule.Service COM object end-to-end because
`New-ScheduledTaskTrigger` can't produce a SessionStateChange trigger.
Mixing CIM and COM on one task is fragile; COM-only is simpler.

- [ ] **Step 2: Mirror the script to the Windows side so we can run it**

```bash
cp /home/marku/saas/numaradio/deploy/windows/install-autostart.ps1 /mnt/c/Users/marku/install-autostart.ps1
```

- [ ] **Step 3: Commit the installer**

```bash
cd /home/marku/saas/numaradio
git add deploy/windows/install-autostart.ps1
git commit -m "feat(deploy): installer for WSL-autostart scheduled task"
```

---

## Task 3: Run the installer and verify

Run the script with admin rights, then inspect the resulting task against the spec's target table.

**Files:**
- None (runtime verification)

- [ ] **Step 1: Run the installer elevated**

Admin rights are required because we're modifying a system-wide scheduled task with `RunLevel=Highest`. From WSL:

```bash
powershell.exe -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Users\marku\install-autostart.ps1','-Wait'"
```

Windows will show a UAC prompt — approve it. The script writes its output to the elevated window; close that window when it prints "Task '…' registered." and the trigger/principal tables.

(If UAC from a launched child window is inconvenient, run the same file manually from an elevated PowerShell: right-click "Windows Terminal" → "Run as administrator" → `& C:\Users\marku\install-autostart.ps1`.)

- [ ] **Step 2: Verify triggers from WSL**

```bash
powershell.exe -NoProfile -Command "Get-ScheduledTask -TaskName 'Start WSL (Numa Radio)' | Select-Object -ExpandProperty Triggers | Format-Table CimClass, Enabled"
```

Expected: three rows, classes `MSFT_TaskBootTrigger`, `MSFT_TaskLogonTrigger`, `MSFT_TaskSessionStateChangeTrigger`. All `Enabled=True`.

- [ ] **Step 3: Verify principal**

```bash
powershell.exe -NoProfile -Command "Get-ScheduledTask -TaskName 'Start WSL (Numa Radio)' | Select-Object -ExpandProperty Principal | Format-List UserId, LogonType, RunLevel"
```

Expected:
```
UserId    : ORION\marku
LogonType : S4U
RunLevel  : Highest
```

- [ ] **Step 4: Verify battery settings**

```bash
powershell.exe -NoProfile -Command "Get-ScheduledTask -TaskName 'Start WSL (Numa Radio)' | Select-Object -ExpandProperty Settings | Format-List DisallowStartIfOnBatteries, StopIfGoingOnBatteries, MultipleInstances, ExecutionTimeLimit"
```

Expected:
```
DisallowStartIfOnBatteries : False
StopIfGoingOnBatteries     : False
MultipleInstances          : IgnoreNew
ExecutionTimeLimit         : PT5M
```

If any of the four verifications don't match, STOP and inspect the script output from Step 1.

---

## Task 4: Dry-run the task to prove S4U can launch WSL

The load-bearing unverified assumption is that an S4U (no-session) principal can successfully launch `wsl.exe`. Prove it before trusting the fix.

**Files:**
- None

- [ ] **Step 1: Shut WSL down so we see a real boot**

```bash
powershell.exe -NoProfile -Command "wsl.exe --shutdown"
# Wait a few seconds for the VM to terminate, then:
powershell.exe -NoProfile -Command "wsl.exe -l -v"
```

Expected: Ubuntu state is `Stopped`.

- [ ] **Step 2: Fire the task manually**

```bash
powershell.exe -NoProfile -Command "Start-ScheduledTask -TaskName 'Start WSL (Numa Radio)'"
```

- [ ] **Step 3: Wait and confirm WSL booted**

```bash
sleep 15
powershell.exe -NoProfile -Command "wsl.exe -l -v"
```

Expected: Ubuntu state is `Running`.

- [ ] **Step 4: Confirm the task reported success**

```bash
powershell.exe -NoProfile -Command "Get-ScheduledTaskInfo -TaskName 'Start WSL (Numa Radio)' | Format-List LastRunTime, LastTaskResult, NumberOfMissedRuns"
```

Expected: `LastTaskResult : 0` and `LastRunTime` within the last minute.

If `LastTaskResult` is anything non-zero, check `Microsoft-Windows-TaskScheduler/Operational` event log for the error:

```bash
powershell.exe -NoProfile -Command "Get-WinEvent -LogName 'Microsoft-Windows-TaskScheduler/Operational' -MaxEvents 20 | Where-Object { \$_.Message -match 'Start WSL' } | Select-Object -First 5 TimeCreated, Id, @{n='Msg';e={(\$_.Message -replace '\r?\n',' ').Substring(0,160)}} | Format-Table -AutoSize"
```

Common non-zero codes:
- `2147942402` (0x80070002): `wsl.exe` not on PATH for the task's environment — re-run Step 1 of Task 3 as true Administrator.
- `267009` (0x41301): still running — wait longer, repeat Step 4.

- [ ] **Step 5: Confirm the radio services came up**

```bash
systemctl is-active numa-dashboard numa-liquidsoap numa-queue-daemon icecast2 cloudflared
```

Expected: five lines, all `active`.

- [ ] **Step 6: Smoke-test the public stream**

```bash
curl -sI https://api.numaradio.com/stream | head -5
```

Expected: `HTTP/2 200` plus `icy-*` headers. If you get anything else (connection refused, 502, 404), the tunnel didn't come up — investigate `journalctl -u cloudflared -n 50`.

---

## Task 5: Document the test the user can run after any real reboot

**Files:**
- Modify: `docs/HANDOFF.md` (append a short section)

- [ ] **Step 1: Append a subsection to `docs/HANDOFF.md`**

Add after the "Operator ergonomics — 2026-04-20" section, before the "Radio-feel overhaul" section:

```markdown
**WSL auto-start on Windows boot — 2026-04-21**
Orion runs Numa Radio inside WSL2. Windows scheduled task `Start WSL (Numa Radio)`
now has three triggers (AtStartup / AtLogOn / SessionUnlock) and runs as S4U,
so the radio stack comes back on air after unattended reboots without anyone
logging in. Installer lives at `deploy/windows/install-autostart.ps1`
(run elevated after a Windows reinstall). Backup of the pre-change task at
`deploy/windows/Start-WSL-NumaRadio.backup.xml`.

**After any full Windows reboot, verify from a phone or another device:**
`curl -sI https://api.numaradio.com/stream` should return `200` within ~90s
of POST, *without* logging into Orion. If it doesn't, the first thing to check
is `Get-ScheduledTaskInfo -TaskName 'Start WSL (Numa Radio)'` →
`LastTaskResult` and `Microsoft-Windows-TaskScheduler/Operational` event log.
Rollback: `schtasks /create /tn "Start WSL (Numa Radio)" /xml deploy\windows\Start-WSL-NumaRadio.backup.xml /f`.
```

- [ ] **Step 2: Commit**

```bash
cd /home/marku/saas/numaradio
git add docs/HANDOFF.md
git commit -m "docs(handoff): WSL-autostart note + post-reboot smoke check"
```

---

## Task 6: Final check and push

- [ ] **Step 1: Verify working tree is clean**

```bash
cd /home/marku/saas/numaradio
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Review the commits produced by this plan**

```bash
git log --oneline -6
```

Expected three new commits (backup XML, installer, handoff note), plus the earlier spec commit `98bbf26`.

- [ ] **Step 3: Push**

```bash
git push
```

---

## Out of scope reminders (from the spec)

- No alert when the task fails. Future work: watchdog that pings Telegram if `/status-json.xsl` is unreachable for N minutes after Windows boot.
- No idle-sleep / lid-close tweaks (user has handled this).
- No Windows Update scheduling.
