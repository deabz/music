$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$beforeTask = Get-OwnedTask
$beforeXml = if ($beforeTask) { Export-ScheduledTask -InputObject $beforeTask } else { '' }
$config = Join-Path $Local 'config.json'
$beforeConfig = if (Test-Path $config) { [IO.File]::ReadAllText($config) } else { $null }
$output = & "$PSScriptRoot/install-autostart.ps1" -DryRun
$text = $output -join "`n"
foreach ($required in @('<LogonType>InteractiveToken</LogonType>', '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '<WakeToRun>false</WakeToRun>', '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>', '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>', '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>', '<Hidden>true</Hidden>')) {
    if (!$text.Contains($required)) { throw "Missing XML setting: $required" }
}
$afterTask = Get-OwnedTask
$afterXml = if ($afterTask) { Export-ScheduledTask -InputObject $afterTask } else { '' }
$afterConfig = if (Test-Path $config) { [IO.File]::ReadAllText($config) } else { $null }
if ($beforeXml -cne $afterXml -or $beforeConfig -cne $afterConfig) { throw 'DryRun changed task or local configuration.' }
Write-Output 'PASS: complete dry-run XML and task settings; task/configuration unchanged.'
