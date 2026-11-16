param([switch]$DryRun)
. "$PSScriptRoot/common.ps1"
$existing = Get-OwnedTask
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
foreach ($f in @('start-bot.bat','scripts\run-bot.ps1','src\index.js')) {
    if (!(Test-Path -LiteralPath (Join-Path $Repo $f) -PathType Leaf)) { throw "Missing $f" }
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$action = New-ScheduledTaskAction -Execute (Join-Path $Repo 'start-bot.bat') -WorkingDirectory $Repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid
$principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$definition = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Discord music bot supervisor; starts after user sign-in.'
$xml = Export-ScheduledTask -InputObject $definition
Write-Output 'Exact task definition:'
Write-Output $xml
Write-Output 'System change: register nyx at current-user logon; no password, elevation, wake timer or immediate launch. Save resolved Node path in ignored .bot-local/config.json. No power settings change.'
if ($DryRun) { return }
if ($existing -and $existing.State -eq 'Running') { throw 'Stop the existing task explicitly before reinstalling.' }
New-Item -ItemType Directory -Force -Path $Local | Out-Null
@{NodePath=$node} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Local 'config.json') -Encoding ASCII
Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime,LastTaskResult,NextRunTime

