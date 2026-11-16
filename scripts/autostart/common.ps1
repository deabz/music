$ErrorActionPreference = 'Stop'
$Repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$Local = Join-Path $Repo '.bot-local'
$Flag = Join-Path $Repo 'stop-bot.flag'
$TaskName = 'nyx'
function Get-OwnedTask {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        $a = @($task.Actions)
        if ($a.Count -ne 1 -or $a[0].Execute -ine (Join-Path $Repo 'start-bot.bat') -or $a[0].WorkingDirectory -ine $Repo) { throw 'Task belongs to another setup; refusing to modify it.' }
    }
    return $task
}
function Stop-OwnedSupervisor {
    $path = Join-Path $Local 'state.json'
    if (Test-Path $path) {
        $s = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        $p = Get-Process -Id $s.Pid -ErrorAction SilentlyContinue
        if ($p) {
            if ($p.ProcessName -ine 'powershell' -or $p.StartTime.ToUniversalTime().Ticks -ne [long]$s.CreatedTicks) { throw 'Ambiguous process identity; nothing stopped.' }
            Stop-Process -Id $p.Id -Force
        }
    }
}


