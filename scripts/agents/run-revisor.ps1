# Daily scheduled run of the "revisor" agent (00:00).
# Reviews every new commit on develop since the previous review and saves the report in
# docs/revisiones/YYYY-MM-DD.md. The agent itself cannot write files: this script does.
# ASCII-only file (Windows PowerShell 5.1 compatible).
. (Join-Path $PSScriptRoot 'common.ps1')
Start-RunLog 'revisor'

$allowedTools = @('Read', 'Glob', 'Grep', 'Bash')
$deniedTools  = @(
    'Write', 'Edit', 'NotebookEdit',
    'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)',
    'Bash(git reset:*)', 'Bash(git stash:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)',
    'Bash(git restore:*)', 'Bash(git clean:*)', 'Bash(git worktree:*)', 'Bash(git add:*)',
    'Bash(node scripts/test-lock.ts lock:*)'
)
$markerRel = 'docs/revisiones/ULTIMO_COMMIT_REVISADO'

# While paused, nothing is lost: the next review covers every commit since the last one.
if (Test-AgentsPaused) { exit 0 }

# The 23:00 developer run may still be working: wait for it (up to 3 h).
if (-not (Enter-AgentLock 'revisor' 180)) {
    Write-RunLog 'The developer run did not finish in 3 h; skipping today''s review.'
    exit 1
}

try {
    Set-GitBashPath
    Initialize-AgentWorktree
    Save-LeftoverWork 'before the review'

    $head = Get-GitValue @('rev-parse', 'HEAD')
    $markerPath = Join-Path $AgentWorktree $markerRel
    if (Test-Path $markerPath) {
        $from = (Get-Content $markerPath -Raw).Trim()
    } else {
        $from = Get-GitValue @('merge-base', 'master', 'develop')
    }
    if ($from -eq $head) {
        Write-RunLog 'No new commits on develop since the last review; nothing to do.'
        exit 0
    }

    # The run starts at 00:00, so the day being reviewed is the one that just ended.
    $day = (Get-Date).AddHours(-1).ToString('yyyy-MM-dd')
    $range = '{0}..{1}' -f $from, $head
    $count = Get-GitValue @('rev-list', '--count', $range)
    $prompt = 'Revision diaria programada del {0}. Rango de commits de develop a revisar: {1} ({2} commits). Sigue la seccion "Revision diaria" de tus instrucciones y devuelve solo el informe en Markdown.' -f $day, $range, $count

    Write-RunLog "Reviewing $range ($count commits)."
    Push-Location $AgentWorktree
    $claudeArgs = @('-p', '--agent', 'revisor', '--allowedTools') + $allowedTools +
                  @('--disallowedTools') + $deniedTools + @('--', $prompt)
    $report = & (Get-ClaudeExe) @claudeArgs 2>$null | Out-String
    $exit = $LASTEXITCODE
    Pop-Location

    if ($exit -ne 0 -or -not $report.Trim()) {
        Write-RunLog ("Reviewer failed (exit {0}); no report saved. Output:`n{1}" -f $exit, $report)
        exit 1
    }

    # The review must not have changed anything; if it did, discard it into a stash.
    $status = Get-GitValue @('status', '--porcelain')
    if ($status) {
        Write-RunLog "The review left changes in the worktree; stashing them as 'revisor-leftover':`n$status"
        Invoke-Git @('stash', 'push', '-u', '-m', 'revisor-leftover') | Out-Null
    }

    $reviewDir = Join-Path $AgentWorktree 'docs\revisiones'
    New-Item -ItemType Directory -Force -Path $reviewDir | Out-Null
    $reportPath = Join-Path $reviewDir "$day.md"
    $n = 2
    while (Test-Path $reportPath) { $reportPath = Join-Path $reviewDir "$day-$n.md"; $n++ }
    [System.IO.File]::WriteAllText($reportPath, $report.Trim() + [Environment]::NewLine, $Utf8NoBom)
    [System.IO.File]::WriteAllText($markerPath, $head + [Environment]::NewLine, $Utf8NoBom)
    Write-RunLog "Report saved: $reportPath"

    Invoke-Git @('add', 'docs/revisiones') | Out-Null
    if (Invoke-Git @('commit', '-m', "docs(revision): revision diaria $day")) {
        Invoke-Git @('push', '-u', 'origin', 'develop') | Out-Null
    }
} catch {
    Write-RunLog ("ERROR: {0}" -f $_.Exception.Message)
    exit 1
} finally {
    Exit-AgentLock
}
