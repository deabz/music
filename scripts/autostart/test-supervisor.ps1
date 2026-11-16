$ErrorActionPreference = 'Stop'
$supervisor = Join-Path $PSScriptRoot '../run-bot.ps1'
. "$PSScriptRoot/ownership.ps1"
function Assert($value,[string]$message) { if (!$value) { throw "FAIL: $message" } }
function Wait-For($condition,[int]$seconds=30) {
    $until = [DateTime]::UtcNow.AddSeconds($seconds)
    do { if (& $condition) { return }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $until)
    throw 'Timed out waiting for fake process test.'
}
function Launch([string]$root,[switch]$Rotate) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = 'powershell.exe'
    $info.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $supervisor + '"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['BOT_SUPERVISOR_TEST'] = '1'
    $info.EnvironmentVariables['BOT_TEST_ROOT'] = $root
    $info.EnvironmentVariables['BOT_TEST_ROTATE'] = [int][bool]$Rotate
    return [Diagnostics.Process]::Start($info)
}
$roots = @()
$launched = @()
$ownedPids = @()
function New-Root([string]$fake) {
    $r = Join-Path ([IO.Path]::GetTempPath()) ('nyx-supervisor-test-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory $r | Out-Null
    Set-Content (Join-Path $r 'fake.ps1') $fake -Encoding ASCII
    return $r
}
try {
    foreach ($record in @(@{CommandLine=$null},@{CommandLine='node src\index.js'},@{CommandLine='node index.js'},@{CommandLine='node .'},@{CommandLine='node "C:\repo\src\index.js"'})) {
        $blocked=$false
        try { Assert-NoExistingBot @($record) 'C:\repo\src\index.js' } catch { $blocked=$true }
        Assert $blocked 'duplicate/ambiguous bot must be rejected'
    }
    Assert-NoExistingBot @(@{CommandLine='node C:\other\server.js'}) 'C:\repo\src\index.js'
    Write-Output 'PASS: ownership rejects duplicates and ambiguity, permits unrelated command.'
    $r = New-Root @'
$countFile = Join-Path $PSScriptRoot 'count'
$n = 0
if (Test-Path $countFile) { $n = [int](Get-Content $countFile) }
$n++
Set-Content $countFile $n
Write-Output "fake stdout $n"
[Console]::Error.WriteLine("fake stderr $n")
if ($n -eq 6) { Start-Sleep -Seconds 7 }
if ($n -ge 7) { New-Item -ItemType File (Join-Path $PSScriptRoot 'stop-bot.flag') | Out-Null }
exit 17
'@
    $roots += $r
    $p = Launch $r; $launched += $p
    Assert ($p.WaitForExit(45000)) 'backoff test finishes'
    Assert ($p.ExitCode -eq 0) ('backoff supervisor exit: ' + $p.StandardError.ReadToEnd())
    $log = Get-Content (Join-Path $r 'logs\bot.log') -Raw
    $actual = @([regex]::Matches($log,'restart delay=(\d+)') | ForEach-Object { $_.Groups[1].Value })
    Assert (($actual -join ',') -eq '10,30,60,300,300,10') "delay sequence ($($actual -join ','))"
    Assert ($log -match 'Backoff reset') 'backoff reset logged'
    Assert ($log -match 'Exit code=17') 'exit code captured'
    Assert ($log -match 'fake stdout' -and $log -match 'fake stderr') 'stdout and stderr captured'
    $events = @([regex]::Matches($log,'\[([^\]]+)\] (Start child|Exit code=17; restart delay=(\d+))'))
    for ($i=0; $i -lt $events.Count-1; $i++) {
        if ($events[$i].Groups[3].Success -and $events[$i+1].Groups[2].Value -eq 'Start child') {
            $elapsed = ([DateTime]::Parse($events[$i+1].Groups[1].Value)-[DateTime]::Parse($events[$i].Groups[1].Value)).TotalSeconds
            Assert ($elapsed -ge ([int]$events[$i].Groups[3].Value * 0.01)) 'actual scaled delay honored'
        }
    }
    Assert (!(Test-Path (Join-Path $r '.bot-local\state.json'))) 'state removed'
    Write-Output 'PASS: 10/30/60/300/300 delays, backoff reset, streams and exit codes.'
    $r = New-Root @'
1..200 | ForEach-Object { Write-Output ('x' * 200) }
Start-Sleep -Seconds 2
New-Item -ItemType File (Join-Path $PSScriptRoot 'stop-bot.flag') | Out-Null
exit 4
'@
    $roots += $r
    $p = Launch $r -Rotate; $launched += $p
    Assert ($p.WaitForExit(20000)) 'rotation finishes'
    $rotated = @(Get-ChildItem (Join-Path $r 'logs') | Where-Object Name -match '^bot\.log\.[1-5]$')
    Assert ($rotated.Count -eq 5) ('five rotated logs retained: ' + (@(Get-ChildItem (Join-Path $r 'logs') | ForEach-Object { "$($_.Name)=$($_.Length)" }) -join ',') + '; stderr: ' + $p.StandardError.ReadToEnd())
    Assert (@($rotated | Where-Object Length -gt 2700).Count -eq 0) 'rotation size bounded'
    Write-Output 'PASS: rotation and five-log retention.'
    $r = New-Root @'
$child = Start-Process powershell.exe -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru
Set-Content (Join-Path $PSScriptRoot 'grandchild.pid') $child.Id
Start-Sleep -Seconds 120
'@
    $roots += $r
    New-Item -ItemType File (Join-Path $r 'stop-bot.flag') | Out-Null
    $p = Launch $r; $launched += $p
    Assert ($p.WaitForExit(10000)) 'preexisting flag exits'
    Assert (!(Test-Path (Join-Path $r 'grandchild.pid'))) 'flag prevents launch'
    Remove-Item (Join-Path $r 'stop-bot.flag')
    foreach ($forced in @($false,$true)) {
        Remove-Item (Join-Path $r 'grandchild.pid') -ErrorAction SilentlyContinue
        $p = Launch $r; $launched += $p
        Wait-For { Test-Path (Join-Path $r 'grandchild.pid') }
        $grandchild = [int](Get-Content (Join-Path $r 'grandchild.pid'))
        $state = Get-Content (Join-Path $r '.bot-local\state.json') -Raw | ConvertFrom-Json
        $ownedPids += @($grandchild,$state.ChildPid)
        if (!$forced) {
            $second = Launch $r; $launched += $second
            Assert ($second.WaitForExit(10000)) 'duplicate exits'
            Assert ($second.ExitCode -ne 0) 'duplicate rejected'
            Assert (!(Get-Process -Id $p.Id).HasExited) 'first supervisor survives'
            New-Item -ItemType File (Join-Path $r 'stop-bot.flag') | Out-Null
            Assert ($p.WaitForExit(10000)) 'flag stops supervisor'
        } else { $p.Kill(); $p.WaitForExit() }
        Wait-For { !(Get-Process -Id $grandchild -ErrorAction SilentlyContinue) -and !(Get-Process -Id $state.ChildPid -ErrorAction SilentlyContinue) }
        Remove-Item (Join-Path $r 'stop-bot.flag') -ErrorAction SilentlyContinue
    }
    Write-Output 'PASS: duplicate supervisor, stop flags, graceful and forced child-tree cleanup.'
} finally {
    foreach ($p in $launched) { if (!$p.HasExited) { $p.Kill(); $p.WaitForExit() } }
    foreach ($id in $ownedPids) { if (Get-Process -Id $id -ErrorAction SilentlyContinue) { Stop-Process -Id $id -Force } }
    foreach ($r in $roots) {
        $resolved = [IO.Path]::GetFullPath($r)
        $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if (!$resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'nyx-supervisor-test-*') { throw 'Unsafe test cleanup path' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
Write-Output 'All supervisor tests passed; temporary processes and files removed.'
