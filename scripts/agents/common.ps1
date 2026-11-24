# Shared helpers for the scheduled agent runs (desarrollador / revisor).
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less files as ANSI.
#
# The agents never work in the owner's checkout. They use a separate git worktree
# (a sibling folder ending in "-agentes") with the "develop" branch checked out.

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:RepoRoot      = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:AgentWorktree = Join-Path (Split-Path $RepoRoot -Parent) ((Split-Path $RepoRoot -Leaf) + '-agentes')
$script:LockFile      = Join-Path $RepoRoot '.git\agents.lock'
$script:PauseFile     = Join-Path $RepoRoot '.git\agents.pause'   # if it exists, scheduled runs skip
$script:LogDir        = Join-Path $RepoRoot 'logs\agents'
$script:StaleLockMinutes = 190   # longer than the 3 h execution limit of the scheduled tasks
$script:CurrentLog    = $null
$script:Utf8NoBom     = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Start-RunLog([string]$agent) {
    $stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
    $script:CurrentLog = Join-Path $LogDir "$stamp-$agent.log"
}

function Write-RunLog([string]$message) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    [System.IO.File]::AppendAllText($script:CurrentLog, $line + [Environment]::NewLine, $script:Utf8NoBom)
    Write-Host $line
}

# Windows PowerShell 5.1 turns every stderr line of a native command (git, npm, claude) into an
# error record, which prints as a noisy "NativeCommandError". Convert everything to plain text.
function ConvertTo-PlainText {
    $lines = @($input | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    })
    return ($lines -join [Environment]::NewLine)
}

# Runs git in the agents worktree; logs the output and returns $true on success.
function Invoke-Git([string[]]$GitArgs, [string]$Dir = $script:AgentWorktree) {
    $output = & git -C $Dir @GitArgs 2>&1 | ConvertTo-PlainText
    $ok = ($LASTEXITCODE -eq 0)
    if ($output.Trim()) { Write-RunLog ("git {0}`n{1}" -f ($GitArgs -join ' '), $output.TrimEnd()) }
    if (-not $ok) { Write-RunLog ("git {0} FAILED (exit {1})" -f ($GitArgs -join ' '), $LASTEXITCODE) }
    return $ok
}

function Get-GitValue([string[]]$GitArgs, [string]$Dir = $script:AgentWorktree) {
    $value = & git -C $Dir @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($value | Out-String).Trim()
}

# Claude Code needs Git Bash to run the project hooks. Git is installed in a
# non-standard folder, so headless runs must be told where bash.exe is.
function Set-GitBashPath {
    if ($env:CLAUDE_CODE_GIT_BASH_PATH -and (Test-Path $env:CLAUDE_CODE_GIT_BASH_PATH)) { return }
    $candidates = New-Object System.Collections.Generic.List[string]
    # git.exe may live in <Git>\cmd, <Git>\bin or <Git>\mingw64\bin: walk up looking for <Git>\bin\bash.exe.
    foreach ($git in @(Get-Command git -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })) {
        $dir = Split-Path $git -Parent
        for ($i = 0; $i -lt 4 -and $dir; $i++) {
            $candidates.Add((Join-Path $dir 'bin\bash.exe'))
            $dir = Split-Path $dir -Parent
        }
    }
    $candidates.Add('C:\Git\bin\bash.exe')
    $candidates.Add((Join-Path $env:ProgramFiles 'Git\bin\bash.exe'))
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { $env:CLAUDE_CODE_GIT_BASH_PATH = $candidate; return }
    }
    throw 'Git Bash not found. Set the CLAUDE_CODE_GIT_BASH_PATH environment variable.'
}

function Get-ClaudeExe {
    $claude = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $claude) { throw 'Claude Code CLI (claude) not found in PATH.' }
    return $claude.Source
}

# Exclusive lock shared by both agents, so they never work on the repo at the same time.
function Enter-AgentLock([string]$owner, [int]$waitMinutes) {
    $deadline = (Get-Date).AddMinutes($waitMinutes)
    while ($true) {
        if (Test-Path $LockFile) {
            $age = (Get-Date) - (Get-Item $LockFile).LastWriteTime
            if ($age.TotalMinutes -ge $StaleLockMinutes) {
                Write-RunLog ("Removing stale lock ({0} min old): {1}" -f [int]$age.TotalMinutes, (Get-Content $LockFile -Raw))
                Remove-Item $LockFile -Force
            }
        }
        try {
            $stream = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
            $writer = New-Object System.IO.StreamWriter($stream)
            $writer.Write(('{0} pid={1} since={2}' -f $owner, $PID, (Get-Date -Format s)))
            $writer.Close()
            return $true
        } catch [System.IO.IOException] {
            if ((Get-Date) -ge $deadline) { return $false }
            Write-RunLog ('Lock busy ({0}); waiting 5 min.' -f (Get-Content $LockFile -Raw -ErrorAction SilentlyContinue))
            Start-Sleep -Seconds 300
        }
    }
}

function Test-AgentsPaused {
    if (Test-Path $PauseFile) {
        Write-RunLog 'Agents are paused (.git/agents.pause exists); skipping this run.'
        return $true
    }
    return $false
}

function Exit-AgentLock {
    if (Test-Path $LockFile) { Remove-Item $LockFile -Force }
}

# Creates the agents worktree on "develop" if needed and fast-forwards it to origin/develop.
function Initialize-AgentWorktree {
    & git -C $RepoRoot fetch origin --quiet 2>&1 | Out-Null
    $hasLocal  = $null -ne (Get-GitValue @('rev-parse', '--verify', '--quiet', 'refs/heads/develop') $RepoRoot)
    $hasRemote = $null -ne (Get-GitValue @('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/develop') $RepoRoot)

    if (-not (Test-Path (Join-Path $AgentWorktree '.git'))) {
        Write-RunLog "Creating agents worktree at $AgentWorktree"
        if ($hasLocal) {
            $ok = Invoke-Git @('worktree', 'add', $AgentWorktree, 'develop') $RepoRoot
        } elseif ($hasRemote) {
            $ok = Invoke-Git @('worktree', 'add', '--track', '-b', 'develop', $AgentWorktree, 'origin/develop') $RepoRoot
        } else {
            $ok = Invoke-Git @('worktree', 'add', '-b', 'develop', $AgentWorktree, 'master') $RepoRoot
        }
        if (-not $ok) { throw 'Could not create the agents worktree.' }
    }

    $branch = Get-GitValue @('rev-parse', '--abbrev-ref', 'HEAD')
    if ($branch -ne 'develop') { throw "Agents worktree is on '$branch' instead of 'develop'." }

    if ($hasRemote) {
        if (-not (Invoke-Git @('merge', '--ff-only', 'origin/develop'))) {
            throw 'develop cannot be fast-forwarded to origin/develop (diverged). Fix it by hand.'
        }
    }

    # Bring in the owner's changes from master (docs, designs, scripts) before the agent works.
    & git -C $AgentWorktree merge-base --is-ancestor master HEAD 2>$null
    if ($LASTEXITCODE -ne 0) {
        & git -C $AgentWorktree merge-base --is-ancestor HEAD master 2>$null
        if ($LASTEXITCODE -eq 0) {
            # develop has no commits of its own yet: just move it forward.
            Invoke-Git @('merge', '--ff-only', 'master') | Out-Null
        } elseif (-not (Invoke-Git @('merge', '--no-ff', '--no-edit', '-m', 'chore: incorpora a develop los cambios de master', 'master'))) {
            # A conflict: leave develop as it was and let the owner merge by hand.
            Invoke-Git @('merge', '--abort') | Out-Null
            Write-RunLog 'WARNING: master could not be merged into develop automatically (conflict). Merge it by hand.'
        }
    }

    # Dependencies: install them if the project has a package.json but no node_modules yet.
    $pkg = Join-Path $AgentWorktree 'package.json'
    if ((Test-Path $pkg) -and -not (Test-Path (Join-Path $AgentWorktree 'node_modules'))) {
        Write-RunLog 'Installing npm dependencies in the agents worktree.'
        Push-Location $AgentWorktree
        & npm install 2>&1 | ConvertTo-PlainText | ForEach-Object { Write-RunLog $_.TrimEnd() }
        Pop-Location
    }
}

# Uncommitted work left in the worktree (e.g. a run killed by the time limit) is saved
# in a stash so the next run can resume it and the tree is clean.
function Save-LeftoverWork([string]$reason) {
    $status = Get-GitValue @('status', '--porcelain')
    if ($status) {
        Write-RunLog "Uncommitted changes found ($reason); saving them in stash 'wip-desarrollador':`n$status"
        Invoke-Git @('stash', 'push', '-u', '-m', 'wip-desarrollador') | Out-Null
    }
}

function Test-TestLock {
    Push-Location $AgentWorktree
    $output = & node scripts/test-lock.ts check 2>&1 | ConvertTo-PlainText
    $ok = ($LASTEXITCODE -eq 0)
    Pop-Location
    Write-RunLog ("test-lock check: {0}" -f $output.Trim())
    return $ok
}
