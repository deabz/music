. "$PSScriptRoot/stop-bot.ps1"
if (Get-OwnedTask) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
Write-Output 'Task removed. Stop flag and local logs/configuration retained.'
