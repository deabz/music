$ErrorActionPreference = 'Stop'
$Repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$test = $env:BOT_SUPERVISOR_TEST -ceq '1'
$scale = 1.0
$limit = 5MB
if ($test) {
    $Repo = [IO.Path]::GetFullPath($env:BOT_TEST_ROOT)
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (!$Repo.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path (Join-Path $Repo 'fake.ps1'))) { throw 'Test root must contain fake.ps1 under TEMP.' }
    $scale = 0.01
    if ($env:BOT_TEST_ROTATE -ceq '1') { $limit = 2048 }
}
$local = Join-Path $Repo '.bot-local'
$logDir = Join-Path $Repo 'logs'
$flag = Join-Path $Repo 'stop-bot.flag'
New-Item -ItemType Directory -Force -Path $local,$logDir | Out-Null
$log = Join-Path $logDir 'bot.log'
function Write-Log([string]$message) {
    # Bound each write so one long output line cannot bypass rotation.
    for ($offset=0; $offset -lt $message.Length; $offset+=512) {
        $chunk = $message.Substring($offset,[Math]::Min(512,$message.Length-$offset))
        $bytes = [Text.Encoding]::UTF8.GetByteCount($chunk + "`r`n")
        if ((Test-Path $log) -and ((Get-Item $log).Length + $bytes) -gt $limit) {
            Remove-Item "$log.5" -Force -ErrorAction SilentlyContinue
            for ($n=4; $n -ge 1; $n--) { if (Test-Path "$log.$n") { Move-Item "$log.$n" "$log.$($n+1)" -Force } }
            Move-Item $log "$log.1" -Force
        }
        Add-Content -LiteralPath $log -Value $chunk -Encoding UTF8
    }
}
function Event-Log([string]$message) { Write-Log "[$([DateTime]::UtcNow.ToString('o'))] $message" }
$lock = $null
$job = $null
$statePath = Join-Path $local 'state.json'
try {
    try { $lock = [IO.File]::Open((Join-Path $local 'supervisor.lock'),'OpenOrCreate','ReadWrite','None') }
    catch { Write-Error 'Another supervisor owns this repository lock.'; exit 2 }
    if (Test-Path $flag) { Event-Log 'Stop flag present; no launch.'; exit 0 }
    if (!$test) {
        $config = Get-Content -LiteralPath (Join-Path $local 'config.json') -Raw | ConvertFrom-Json
        $node = $config.NodePath
        if (![IO.Path]::IsPathRooted($node) -or !(Test-Path -LiteralPath $node) -or [IO.Path]::GetFileName($node) -ine 'node.exe') { throw 'Install a valid explicit Node path first.' }
        $entry = Join-Path $Repo 'src\index.js'
        $invoke = "& '$($node.Replace("'","''"))' '$($entry.Replace("'","''"))'; exit `$LASTEXITCODE"
    } else {
        $fake = Join-Path $Repo 'fake.ps1'
        $invoke = "& '$($fake.Replace("'","''"))'; exit `$LASTEXITCODE"
    }
    . "$PSScriptRoot/autostart/ownership.ps1"
    Add-Type -Path (Join-Path $PSScriptRoot 'autostart\BotJob.cs')
    $delays = @(10,30,60,300)
    $level = 0
    while (!(Test-Path $flag)) {
        if (!$test) { Assert-NoExistingBot @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'") $entry }
        $started = [DateTime]::UtcNow
        # The wrapper cannot run any command until assigned to the kill-on-close job.
        $wrapper = "if ([Console]::ReadLine() -ne 'go') { exit 99 }; $invoke"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($wrapper))
        $job = New-Object BotJob $encoded,$Repo
        $self = Get-Process -Id $PID
        @{Pid=$PID;CreatedTicks=$self.StartTime.ToUniversalTime().Ticks;ChildPid=$job.Child.Id} | ConvertTo-Json | Set-Content $statePath -Encoding ASCII
        Event-Log "Start child PID=$($job.Child.Id)"
        while (!$job.Child.HasExited -and !(Test-Path $flag)) {
            $line = $null
            while ($job.Lines.TryDequeue([ref]$line)) { Write-Log $line }
            Start-Sleep -Milliseconds 50
        }
        if (Test-Path $flag) {
            Event-Log 'Stop flag observed; closing child job.'
            $job.Dispose()
            $job.Child.WaitForExit()
            $line = $null
            while ($job.Lines.TryDequeue([ref]$line)) { Write-Log $line }
            Event-Log "Exit code=$($job.Child.ExitCode); intentional stop, no restart"
            break
        }
        $job.Child.WaitForExit()
        $line = $null
        while ($job.Lines.TryDequeue([ref]$line)) { Write-Log $line }
        $code = $job.Child.ExitCode
        $job.Dispose(); $job = $null
        if (([DateTime]::UtcNow-$started).TotalSeconds -ge (600*$scale)) { $level=0; Event-Log 'Backoff reset after ten-minute run.' }
        $delay = $delays[$level]
        Event-Log "Exit code=$code; restart delay=$delay seconds"
        $level = [Math]::Min($level+1,3)
        $until = [DateTime]::UtcNow.AddSeconds($delay*$scale)
        while ([DateTime]::UtcNow -lt $until -and !(Test-Path $flag)) { Start-Sleep -Milliseconds 10 }
    }
} catch { if ($lock) { Event-Log "Supervisor error: $($_.Exception.Message)" }; throw }
finally {
    if ($job) { $job.Dispose() }
    if ($lock) { Remove-Item $statePath -Force -ErrorAction SilentlyContinue; $lock.Dispose() }
}


