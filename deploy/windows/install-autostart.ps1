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

# --- Install .wslconfig so the VM doesn't idle-shutdown after the task's -
# one-shot wsl.exe call exits. Without this, the VM dies ~60s after the
# scheduled task fires and the radio stack goes offline before anyone
# notices. See Decisions Log 2026-04-21 (player-auto-reconnect + WSL idle).
$repoRoot  = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$wslSrc    = Join-Path $PSScriptRoot 'wslconfig'
$wslDst    = Join-Path $env:USERPROFILE '.wslconfig'
if (Test-Path $wslSrc) {
    Copy-Item -Path $wslSrc -Destination $wslDst -Force
    Write-Host "Installed .wslconfig -> $wslDst"
} else {
    Write-Warning ".wslconfig source not found at $wslSrc — skipping"
}

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
