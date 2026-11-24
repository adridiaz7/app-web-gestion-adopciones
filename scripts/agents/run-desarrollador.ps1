# One scheduled run of the "desarrollador" agent (every hour, 06:00-23:00).
# ASCII-only file (Windows PowerShell 5.1 compatible).
. (Join-Path $PSScriptRoot 'common.ps1')
Start-RunLog 'desarrollador'

# Tools the agent may use, and commands it must never run (deny rules win over allow).
$allowedTools = @('Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash')
$deniedTools  = @(
    'Bash(git push:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git merge:*)',
    'Bash(git rebase:*)', 'Bash(git reset:*)', 'Bash(git commit --amend:*)', 'Bash(git branch -D:*)',
    'Bash(git worktree:*)', 'Bash(git clean:*)', 'Bash(git filter-branch:*)', 'Bash(npm publish:*)'
)

if (Test-AgentsPaused) { exit 0 }

if (-not (Enter-AgentLock 'desarrollador' 0)) {
    Write-RunLog 'Another agent run is in progress; skipping this hour.'
    exit 0
}

try {
    Set-GitBashPath
    Initialize-AgentWorktree
    Save-LeftoverWork 'before the run'

    $before = Get-GitValue @('rev-parse', 'HEAD')
    $prompt = 'Ejecucion programada del agente desarrollador. Hora de inicio: {0}. Trabajas en modo autonomo: sigue la seccion "Modo autonomo" de tus instrucciones y docs/plan-de-desarrollo.md, incluido el presupuesto de tiempo (encadenar tareas durante unos 40 minutos desde la hora de inicio).' -f (Get-Date -Format 'yyyy-MM-dd HH:mm')

    Write-RunLog "Starting agent (HEAD $before)."
    Push-Location $AgentWorktree
    $claudeArgs = @('-p', '--agent', 'desarrollador', '--permission-mode', 'acceptEdits',
                    '--allowedTools') + $allowedTools + @('--disallowedTools') + $deniedTools + @('--', $prompt)
    $output = & (Get-ClaudeExe) @claudeArgs 2>&1 | ConvertTo-PlainText
    $exit = $LASTEXITCODE
    Pop-Location
    Write-RunLog ("Agent finished (exit {0}). Report:`n{1}" -f $exit, $output.TrimEnd())

    Save-LeftoverWork 'after the run'

    $after  = Get-GitValue @('rev-parse', 'HEAD')
    $remote = Get-GitValue @('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/develop')
    if ($after -eq $before) { Write-RunLog 'The agent made no new commits.' }
    if ($after -eq $remote) {
        Write-RunLog 'Nothing to push.'
    } elseif (-not (Test-TestLock)) {
        Write-RunLog 'Locked tests were modified: NOT pushing. Review the commits by hand.'
    } else {
        Invoke-Git @('push', '-u', 'origin', 'develop') | Out-Null
    }
} catch {
    Write-RunLog ("ERROR: {0}" -f $_.Exception.Message)
    exit 1
} finally {
    Exit-AgentLock
}
