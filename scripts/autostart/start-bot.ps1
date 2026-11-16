. "$PSScriptRoot/common.ps1"
if (!(Get-OwnedTask)) { throw 'Install the task first.' }
Remove-Item -LiteralPath $Flag -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName
