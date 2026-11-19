param([string]$Helper = (Join-Path $PSScriptRoot '../content-deploy.ps1'))
$ErrorActionPreference = 'Stop'
. $Helper
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('maid-window-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixture)
$file = Join-Path $fixture 'pending.json'
if (Get-AnnouncedContentPlan $file) { throw 'Absent queue entered countdown' }
'{"schema":1,"id":"legacy-plan"}' | Set-Content -LiteralPath $file -Encoding UTF8
if (Get-AnnouncedContentPlan $file) { throw 'Existing default backup behavior changed' }
'{"schema":1,"id":"unsafe/id","maintenanceWindow":"reviewed-party-checkpoint-v1"}' | Set-Content -LiteralPath $file -Encoding UTF8
$refused = $false
try { Get-AnnouncedContentPlan $file } catch { $refused = $true }
if (-not $refused) { throw 'Invalid plan identification accepted' }
'{"schema":1,"id":"test-maid-window","maintenanceWindow":"reviewed-party-checkpoint-v1"}' | Set-Content -LiteralPath $file -Encoding UTF8
$plan = Get-AnnouncedContentPlan $file
if ($plan.id -cne 'test-maid-window') { throw 'Missing reviewed plan' }
function DungeonActive { return $true }
if (-not (Test-ContentChallengeActive $null)) { throw 'Legacy challenge preflight changed' }
function Get-Date { return [datetime]'2026-11-20T04:00:00' + [timespan]::FromSeconds($script:elapsed) }
function Start-Sleep([int]$Seconds) { $script:elapsed += $Seconds }
function HumanPlayers { if ($script:humanAt -ge 0 -and $script:elapsed -ge $script:humanAt) { 'SyntheticPlayer' } }
function Test-ContentChallengeActive($plan) { return ($script:activeAt -ge 0 -and $script:elapsed -ge $script:activeAt) }
function Send-ContentWindowNotice($plan, $phase, $remaining) { $script:messages += "$phase$remaining" }
function Check-Window([int]$humanAt, [int]$activeAt, [bool]$expected, [string]$notices) {
    $script:elapsed = 0
    $script:humanAt = $humanAt
    $script:activeAt = $activeAt
    $script:messages = @()
    if ((Wait-ContentWindow $plan) -ne $expected -or ($script:messages -join ',') -cne $notices) {
        throw ('Unexpected maintenance window decision: ' + ($script:messages -join ','))
    }
}
Check-Window -1 -1 $true 'before180,before60,before10'
if ($script:elapsed -ne 180) { throw 'Countdown duration changed' }
Check-Window 0 -1 $false ''
Check-Window -1 0 $false ''
Check-Window 135 -1 $false 'before180,before60,cancelled'
Check-Window -1 175 $false 'before180,before60,before10,cancelled'
Write-Output 'Scheduled release checks passed for legacy plans, notices, players and active challenges.'
