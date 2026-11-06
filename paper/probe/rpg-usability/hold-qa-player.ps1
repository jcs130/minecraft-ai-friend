param([Parameter(Mandatory=$true)][string]$Stage,[Parameter(Mandatory=$true)][string]$PlayerId)
$ErrorActionPreference='Stop'
$root=(Get-Item -LiteralPath $Stage).FullName
if([IO.File]::ReadAllText((Join-Path $root '.shop-qa')) -cne 'FRESH_RPG_SHOP_QA_NO_PLAYER_DATA'){throw 'Not marked shop QA'}
if([IO.File]::ReadAllText((Join-Path $root '.qa-only')) -cne 'VORTEX_TAKEOVER_QA_ONLY'){throw 'Not marked RPG QA'}
$settings=[IO.File]::ReadAllText((Join-Path $root 'server.properties'))
if($settings -notmatch '(?m)^server-ip=127\.0\.0\.1\r?$' -or $settings -notmatch '(?m)^server-port=25928\r?$'){throw 'Not isolated loopback QA'}
if($PlayerId -notmatch '^[a-f0-9-]{36}$'){throw 'Bad synthetic UUID'}
$target=Join-Path $root ('world/playerdata/'+$PlayerId+'.dat')
$stream=[IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{[Console]::WriteLine('held');[Console]::Out.Flush();[void][Console]::ReadLine()}finally{$stream.Dispose()}
