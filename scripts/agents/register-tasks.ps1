# Registers (or removes with -Remove) the two scheduled tasks in Windows Task Scheduler.
#   powershell -ExecutionPolicy Bypass -File scripts\agents\register-tasks.ps1                    (developer every hour)
#   powershell -ExecutionPolicy Bypass -File scripts\agents\register-tasks.ps1 -IntervalHours 2   (every 2 hours)
#   powershell -ExecutionPolicy Bypass -File scripts\agents\register-tasks.ps1 -Remove
# Running it again replaces the existing tasks, so it is also how the interval is changed.
# Tasks run as the current user, only while that user is logged on.
# ASCII-only file (Windows PowerShell 5.1 compatible).
param(
    [switch]$Remove,
    [ValidateRange(1, 17)][int]$IntervalHours = 1
)

$devName = 'Lagun - agente desarrollador'
$revName = 'Lagun - agente revisor'

if ($Remove) {
    foreach ($name in @($devName, $revName)) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "Removed: $name"
    }
    return
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ps = (Get-Command powershell.exe).Source
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'

# Runs without any visible window, so it cannot be closed by mistake (closing the console
# window kills the agent). "conhost --headless" gives the script a console with no window;
# if it is not available, fall back to a hidden PowerShell window.
function New-AgentAction([string]$script) {
    $file = Join-Path $PSScriptRoot $script
    $psArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $file
    if (Test-Path $conhost) {
        return New-ScheduledTaskAction -Execute $conhost -Argument ('--headless "{0}" {1}' -f $ps, $psArgs) `
            -WorkingDirectory $repoRoot
    }
    return New-ScheduledTaskAction -Execute $ps -Argument $psArgs -WorkingDirectory $repoRoot
}

# Never start a second copy while one is running; kill a run that exceeds 3 h;
# if the PC was off at the scheduled time, run once as soon as possible.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# Developer: from 06:00, every $IntervalHours hour(s), last run no later than 23:00.
$devTrigger = New-ScheduledTaskTrigger -Daily -At '06:00'
$repeat = New-ScheduledTaskTrigger -Once -At '06:00' -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) `
    -RepetitionDuration (New-TimeSpan -Hours 17 -Minutes 1)
$devTrigger.Repetition = $repeat.Repetition
$runsPerDay = [math]::Floor(17 / $IntervalHours) + 1

# Reviewer: every day at 00:00.
$revTrigger = New-ScheduledTaskTrigger -Daily -At '00:00'

Register-ScheduledTask -TaskName $devName -Action (New-AgentAction 'run-desarrollador.ps1') `
    -Trigger $devTrigger -Settings $settings -Force `
    -Description ("Lagun: agente desarrollador (TDD, commits en develop). Cada {0} h desde las 06:00 hasta las 23:00." -f $IntervalHours) | Out-Null
Register-ScheduledTask -TaskName $revName -Action (New-AgentAction 'run-revisor.ps1') `
    -Trigger $revTrigger -Settings $settings -Force `
    -Description 'Lagun: agente revisor. Revision diaria de develop a las 00:00.' | Out-Null

Write-Host ("Registered: {0} (every {1} h from 06:00, {2} runs a day)" -f $devName, $IntervalHours, $runsPerDay)
Write-Host "Registered: $revName (daily 00:00)"
Write-Host "Logs: $(Join-Path $repoRoot 'logs\agents')"
