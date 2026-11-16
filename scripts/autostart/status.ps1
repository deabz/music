. "$PSScriptRoot/common.ps1"
$task = Get-OwnedTask
if ($task) {
    $task | Select-Object TaskName,State
    Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime,LastTaskResult
}
$path = Join-Path $Local 'state.json'
if (Test-Path $path) {
    $s = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $owner = Get-Process -Id $s.Pid -ErrorAction SilentlyContinue
    if ($owner -and $owner.ProcessName -ieq 'powershell' -and $owner.StartTime.ToUniversalTime().Ticks -eq [long]$s.CreatedTicks) {
        $ids = @($s.Pid)
        for ($i=0; $i -lt $ids.Count; $i++) {
            Get-Process -Id $ids[$i] -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,@{n='Uptime';e={(Get-Date) - $_.StartTime}}
            $ids += @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($ids[$i])" -Property ProcessId | Select-Object -ExpandProperty ProcessId)
        }
    } else {
        Write-Output 'Recorded supervisor is absent or stale; no live ownership claimed.'
    }
}
Write-Output "Stop flag: $(Test-Path $Flag)"
$log = Join-Path $Repo 'logs\bot.log'
Write-Output "Log: $log"
if (Test-Path $log) { Get-Content -LiteralPath $log -Tail 20 }
