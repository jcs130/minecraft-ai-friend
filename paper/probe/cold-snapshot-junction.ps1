param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($EvidenceRoot)
if(-not$root.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)-or(Test-Path -LiteralPath $root)){throw 'Use an unused fixture under the repairs root.'}
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('qd-cold-source-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root,$fixture|Out-Null
[IO.File]::WriteAllText((Join-Path $root '.qa-only'),'COLD_SNAPSHOT_SOURCE_ONLY')
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ops\cold-snapshot-source.ps1')
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ops\runtime-relocation.ps1')
$source=Join-Path $fixture 'source';$foreign=Join-Path $fixture 'foreign';$copy=Join-Path $root 'copy';$link=Join-Path $root 'source-link'
New-Item -ItemType Directory -Path $source,$foreign,$copy|Out-Null
[IO.File]::WriteAllText((Join-Path $source 'world.dat'),'fixture-world')
[IO.File]::WriteAllText((Join-Path $source 'account.db-wal'),'nonempty-persistent-wal')
Copy-Item -LiteralPath (Join-Path $source 'world.dat'),(Join-Path $source 'account.db-wal') -Destination $copy
New-Item -ItemType Junction -Path $link -Target $source|Out-Null
$checks=@()
$rejected=$false;try{Relocation-Tree $link|Out-Null}catch{$rejected=$_.Exception.Message-match'ordinary source directory'}
if(-not$rejected){throw 'Expected the exact original junction rejection.'};$checks+='original native comparator rejects an unresolved junction'
$resolved=Resolve-ColdSnapshotSource $link $source
if($resolved-cne$source){throw 'Approved junction did not resolve.'};$checks+='approved cross-volume junction resolves to the exact physical root'
Relocation-Compare @(Relocation-Tree $resolved) @(Relocation-Tree $copy)
$checks+='actual native persistent-file comparison passes on the approved physical root'
$rejected=$false;try{Resolve-ColdSnapshotSource $link $foreign|Out-Null}catch{$rejected=$_.Exception.Message-match'approved physical root'}
if(-not$rejected){throw 'Foreign junction target was accepted.'};$checks+='foreign physical target is refused'
if((Resolve-ColdSnapshotSource $source $source)-cne$source){throw 'Ordinary source refused.'};$checks+='ordinary physical source remains valid'
New-Item -ItemType Junction -Path (Join-Path $source 'unexpected-child') -Target $foreign|Out-Null
$rejected=$false;try{Relocation-Tree (Resolve-ColdSnapshotSource $link $source)|Out-Null}catch{$rejected=$_.Exception.Message-match'Linked runtime children'}
if(-not$rejected){throw 'Linked runtime child was accepted.'};$checks+='native linked-child protection remains enforced'
foreach($row in @(@{path='E:\MC\server';physical='C:\MC-active\paper'},@{path='E:\MC\private\ysm';physical='C:\MC-active\ysm'})){
    if((Resolve-ColdSnapshotSource $row.path $row.physical)-cne$row.physical){throw 'Real NVMe mapping differs.'}
    $checks+=('real migrated source resolves: '+$row.path)
}
$report=@{passed=$true;checks=$checks;gameFilesChanged=$false;fixture=$fixture}
$report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'result.json') -Encoding UTF8
$report|ConvertTo-Json -Depth 5 -Compress
