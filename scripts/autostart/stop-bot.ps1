. "$PSScriptRoot/common.ps1"
$task = Get-OwnedTask
New-Item -ItemType File -Force -Path $Flag | Out-Null
Stop-OwnedSupervisor
if ($task) { Stop-ScheduledTask -TaskName $TaskName }
Write-Output 'Stop flag created; owned supervisor and job children stopped.'
