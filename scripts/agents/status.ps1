# Estado de los agentes de un vistazo.
#   powershell -ExecutionPolicy Bypass -File scripts/agents/status.ps1
# Solo lee: no cambia nada en el repositorio ni en las tareas programadas.
. (Join-Path $PSScriptRoot 'common.ps1')

function Write-Section([string]$title) {
    Write-Host ''
    Write-Host ('== ' + $title + ' ') -ForegroundColor Cyan
}

function Format-Elapsed([TimeSpan]$span) {
    if ($span.TotalHours -ge 1) { return ('{0} h {1} min' -f [int][math]::Floor($span.TotalHours), $span.Minutes) }
    return ('{0} min' -f [int][math]::Floor($span.TotalMinutes))
}

Write-Host ('Estado de los agentes - {0}' -f (Get-Date -Format 'dd/MM/yyyy HH:mm')) -ForegroundColor White

# --- Ahora mismo -------------------------------------------------------------
Write-Section 'Ahora mismo'
if (Test-Path $PauseFile) {
    Write-Host '  PAUSADOS (existe .git/agents.pause): las ejecuciones programadas se saltan.' -ForegroundColor Yellow
}
if (Test-Path $LockFile) {
    $lock = (Get-Content $LockFile -Raw).Trim()
    $since = (Get-Item $LockFile).LastWriteTime
    $who = ($lock -split ' ')[0]
    Write-Host ('  TRABAJANDO: {0}, desde las {1} (hace {2})' -f $who, $since.ToString('HH:mm'), (Format-Elapsed ((Get-Date) - $since))) -ForegroundColor Green
} else {
    Write-Host '  Ningun agente trabajando.'
}

# --- Tareas programadas ------------------------------------------------------
Write-Section 'Tareas programadas'
$tasks = @(Get-ScheduledTask -TaskName 'Lagun*' -ErrorAction SilentlyContinue)
if ($tasks.Count -eq 0) {
    Write-Host '  No hay tareas registradas. Registralas con:' -ForegroundColor Yellow
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/agents/register-tasks.ps1'
} else {
    foreach ($task in $tasks) {
        $info = $task | Get-ScheduledTaskInfo
        $result = switch ($info.LastTaskResult) {
            0       { 'correcta' }
            267009  { 'en marcha' }
            267011  { 'aun no se ha ejecutado' }
            default { 'codigo {0}' -f $info.LastTaskResult }
        }
        $last = if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToString('dd/MM HH:mm') } else { '-' }
        $next = if ($info.NextRunTime) { $info.NextRunTime.ToString('dd/MM HH:mm') } else { '-' }
        $enabled = if ($task.State -eq 'Disabled') { ' (DESACTIVADA)' } else { '' }
        Write-Host ('  {0}{1}' -f $task.TaskName, $enabled)
        Write-Host ('      ultima: {0} ({1})   proxima: {2}' -f $last, $result, $next)
    }
}

# --- Carpeta de los agentes --------------------------------------------------
Write-Section 'Carpeta de los agentes'
if (-not (Test-Path (Join-Path $AgentWorktree '.git'))) {
    Write-Host '  Aun no existe (se crea en la primera ejecucion).'
} else {
    $changes = @(& git -C $AgentWorktree status --porcelain 2>$null)
    if ($changes.Count -gt 0) {
        Write-Host ('  {0} archivo(s) con cambios sin commit (trabajo en curso):' -f $changes.Count)
        $changes | Select-Object -First 8 | ForEach-Object { Write-Host ('    ' + $_) }
        if ($changes.Count -gt 8) { Write-Host '    ...' }
    } else {
        Write-Host '  Sin cambios pendientes.'
    }
    $stashes = @(& git -C $AgentWorktree stash list 2>$null)
    if ($stashes.Count -gt 0) {
        Write-Host ('  Trabajo a medias guardado en stash: {0}' -f $stashes.Count) -ForegroundColor Yellow
    }
}

# --- Commits -----------------------------------------------------------------
Write-Section 'Commits en develop que no estan en master'
$commits = @(& git -C $RepoRoot log master..develop --format='%h %ad  %s' --date=format:'%d/%m %H:%M' 2>$null)
if ($commits.Count -eq 0) {
    Write-Host '  Ninguno.'
} else {
    Write-Host ('  Total: {0}. Ultimos:' -f $commits.Count)
    $commits | Select-Object -First 10 | ForEach-Object { Write-Host ('    ' + $_) }
}

# --- Plan --------------------------------------------------------------------
$planPath = Join-Path $AgentWorktree 'docs\plan-de-desarrollo.md'
if (-not (Test-Path $planPath)) { $planPath = Join-Path $RepoRoot 'docs\plan-de-desarrollo.md' }
Write-Section 'Plan de desarrollo'
$rows = foreach ($line in [System.IO.File]::ReadAllLines($planPath, [System.Text.Encoding]::UTF8)) {
    if ($line -match '^\|\s*(T-\d+)\s*\|\s*(.*?)\s*\|.*\|\s*([A-Z_]+)[^|]*\|\s*$') {
        $title = ($Matches[2] -replace '\*\*', '' -replace '`', '')
        if ($title.Length -gt 70) { $title = $title.Substring(0, 67) + '...' }
        [pscustomobject]@{ Id = $Matches[1]; Title = $title; State = $Matches[3] }
    }
}
$rows = @($rows)
$summary = $rows | Group-Object State | Sort-Object Name | ForEach-Object { '{0}: {1}' -f $_.Name, $_.Count }
Write-Host ('  {0} tareas -> {1}' -f $rows.Count, ($summary -join ' | '))
foreach ($state in @('EN_CURSO', 'CAMBIOS', 'EN_REVISION', 'BLOQUEADA')) {
    foreach ($row in ($rows | Where-Object State -eq $state)) {
        Write-Host ('    {0,-12} {1}  {2}' -f $row.State, $row.Id, $row.Title)
    }
}
$next = $rows | Where-Object State -eq 'PENDIENTE' | Select-Object -First 1
if ($next) { Write-Host ('  Siguiente pendiente: {0}  {1}' -f $next.Id, $next.Title) }

# --- Ultima revision ---------------------------------------------------------
Write-Section 'Ultima revision'
$reviewDir = Join-Path $AgentWorktree 'docs\revisiones'
$review = Get-ChildItem -Path $reviewDir -Filter '*.md' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $review) {
    Write-Host '  Todavia no hay revisiones (el revisor se ejecuta a las 00:00).'
} else {
    Write-Host ('  {0}' -f $review.Name)
    $current = $null
    foreach ($line in [System.IO.File]::ReadAllLines($review.FullName, [System.Text.Encoding]::UTF8)) {
        if ($line -match '^##\s+(T-\d+.*)$') { $current = $Matches[1] }
        elseif ($current -and $line -match 'Veredicto:\**\s*(.+)$') {
            Write-Host ('    {0} -> {1}' -f $current, ($Matches[1] -replace '\*', '').Trim())
            $current = $null
        }
    }
}

# --- Ultima ejecucion --------------------------------------------------------
Write-Section 'Ultima ejecucion registrada'
$log = Get-ChildItem -Path $LogDir -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $log) {
    Write-Host '  Sin registros todavia.'
} else {
    Write-Host ('  {0}  (ultima escritura {1})' -f $log.Name, $log.LastWriteTime.ToString('dd/MM HH:mm'))
    $lines = [System.IO.File]::ReadAllLines($log.FullName, [System.Text.Encoding]::UTF8)
    # Only the script's own timestamped lines, not the agent's report.
    $events = $lines | Where-Object { $_ -cmatch '^\[\d{4}-\d{2}-\d{2} [\d:]+\] (Starting|Agent finished|Reviewing|Reviewer failed|Report saved|ERROR|No new commits|Agents are paused|Another agent|Locked tests|git push)' }
    $events | Select-Object -Last 5 | ForEach-Object {
        $text = $_
        if ($text.Length -gt 110) { $text = $text.Substring(0, 107) + '...' }
        Write-Host ('    ' + $text)
    }
    Write-Host ('  Informe completo: {0}' -f $log.FullName)
}
Write-Host ''
