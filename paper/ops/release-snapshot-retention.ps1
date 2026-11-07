# Retain private maintenance snapshots using the same window as daily backups.
# Dot-sourcing only defines functions. Plan collection never changes files.
function Select-ReleaseSnapshotKeep([array]$Rows,[datetimeoffset]$AsOf=[datetimeoffset]::Now) {
 $ordered=@($Rows|Where-Object {-not $_.Resume}|Sort-Object CreatedAt,Name -Descending)
 $recent=@($ordered|Select-Object -First 3)
 $cutoff=$AsOf.Date.AddDays(-6)
 $daily=@($ordered|Where-Object {$_.CreatedAt.LocalDateTime.Date-ge$cutoff}|Group-Object {$_.CreatedAt.LocalDateTime.ToString('yyyyMMdd')}|ForEach-Object {$_.Group|Select-Object -First 1})
 return @($recent+$daily+@($Rows|Where-Object {$_.Pinned})|ForEach-Object {$_.Path}|Select-Object -Unique)
}

function Get-ReleaseSnapshotPlan([string]$BackupRoot,[datetimeoffset]$AsOf=[datetimeoffset]::Now) {
 $full=[IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')
 $rows=@();$ignored=@()
 foreach($item in @(Get-ChildItem -LiteralPath $full -Directory -Force -ErrorAction Stop)){
  if($item.Name-notmatch '^[a-z0-9-]+-before-refresh-\d{8}(?:-r\d+)?$'){continue}
  if($item.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){$ignored+=,@{name=$item.Name;reason='linked'};continue}
  $pin=(Test-Path -LiteralPath (Join-Path $item.FullName '.keep'))-or(Test-Path -LiteralPath (Join-Path $item.FullName '.pinned'))
  $complete=Test-Path -LiteralPath (Join-Path $item.FullName '.runtime-before.complete')
  $journalPath=Join-Path $full ('.release-retention\'+$item.Name+'.json')
  try{
   if($complete){
    $metaPath=Join-Path $item.FullName 'backup.before.json'
    $meta=Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json
    if($meta.stoppedForCopy-ne$true-or$meta.source-cne'E:\MC\server'-or$meta.serverJarSha256-notmatch'^[0-9a-fA-F]{64}$'){throw 'unrecognized metadata'}
    foreach($rel in @('server\server.jar','server\world\level.dat','ysm-private')){if(-not(Test-Path -LiteralPath (Join-Path $item.FullName $rel))){throw 'missing recovery subtree'}}
    $date=[datetimeoffset]::Parse($meta.createdAt)
    if($date-gt$AsOf.AddMinutes(5)){throw 'future timestamp'}
    $rows+=,[pscustomobject]@{Name=$item.Name;Path=$item.FullName;CreatedAt=$date;Pinned=$pin;Resume=$false;MetadataSha256=(Get-FileHash -LiteralPath $metaPath).Hash;Journal=$journalPath}
   }elseif(Test-Path -LiteralPath $journalPath){
    $saved=Get-Content -LiteralPath $journalPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($saved.schema-ne 1-or$saved.state-cne'pruning'-or$saved.root-cne$full-or$saved.path-cne$item.FullName-or$saved.metadataSha256-notmatch'^[0-9a-fA-F]{64}$'){throw 'unrecognized prune journal'}
    $rows+=,[pscustomobject]@{Name=$item.Name;Path=$item.FullName;CreatedAt=[datetimeoffset]::Parse($saved.createdAt);Pinned=$pin;Resume=$true;MetadataSha256=$saved.metadataSha256;Journal=$journalPath}
   }else{throw 'incomplete without reviewed prune journal'}
  }catch{$ignored+=,@{name=$item.Name;reason=$_.Exception.Message}}
 }
 $keep=@(Select-ReleaseSnapshotKeep $rows $AsOf)
 return [pscustomobject]@{Root=$full;Keep=$keep;Expired=@($rows|Where-Object {$keep-notcontains$_.Path});Ignored=$ignored;ReadOnly=$true}
}

function Assert-ReleaseRecoveryPair {
 $a='E:\MC\backups\scheduled';$b='F:\MC-backups\scheduled'
 $pairs=@(Get-ChildItem -LiteralPath $a -Directory|Where-Object {$_.Name-match'^\d{8}-\d{6}$'-and(Test-Path -LiteralPath (Join-Path $_.FullName '.complete'))-and(Test-Path -LiteralPath (Join-Path (Join-Path $b $_.Name) '.complete'))}|ForEach-Object {
  $meta=Get-Content -LiteralPath (Join-Path $_.FullName 'backup.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if($meta.stoppedForCopy-eq$true){[pscustomobject]@{Name=$_.Name;CreatedAt=[datetimeoffset]::Parse($meta.createdAt)}}
 }|Sort-Object CreatedAt -Descending)
 if($pairs.Count-lt 3-or$pairs[0].CreatedAt-lt[datetimeoffset]::Now.AddDays(-7)){throw 'Need recent verified E/F recovery pairs before pruning'}
 foreach($rel in @('server\server.jar','server\world\level.dat')){
  $left=Join-Path (Join-Path $a $pairs[0].Name) $rel;$right=Join-Path (Join-Path $b $pairs[0].Name) $rel
  if((Get-FileHash -LiteralPath $left).Hash-cne(Get-FileHash -LiteralPath $right).Hash){throw 'Current E/F recovery pair differs'}
 }
 return $pairs[0].Name
}

function Write-ReleaseRetentionJournal([string]$Path,$Value) {
 if((Test-Path -LiteralPath $Path)-and(Get-Item -LiteralPath $Path -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'Linked retention journal file'}
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 5))
 $stream=[IO.FileStream]::new($Path,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}

function Invoke-ReleaseSnapshotRetention([string]$BackupRoot,[datetimeoffset]$AsOf=[datetimeoffset]::Now,[switch]$PlanOnly) {
 $full=[IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')
 if($full-cnotin@('E:\MC\backups','F:\MC-backups')){throw 'Unreviewed release backup root'}
 if((Get-Item -LiteralPath $full -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'Linked backup root'}
 $plan=Get-ReleaseSnapshotPlan $full $AsOf
 if($PlanOnly){return $plan}
 # The native maintenance owns the game lease and has waited for the exact JVM.
 # Also fail closed here if any game/proxy/model listener has returned.
 Relocation-AssertCold
 $pair=Assert-ReleaseRecoveryPair
 $journalRoot=Join-Path $full '.release-retention'
 if(Test-Path -LiteralPath $journalRoot){if((Get-Item -LiteralPath $journalRoot -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'Linked retention journal'}}
 else{New-Item -ItemType Directory -Path $journalRoot -ErrorAction Stop|Out-Null}
 $result=@()
 foreach($old in $plan.Expired){
  try{
   Relocation-AssertCold
   $target=[IO.Path]::GetFullPath($old.Path).TrimEnd('\')
   if([IO.Path]::GetDirectoryName($target)-cne$full-or[IO.Path]::GetFileName($target)-cne$old.Name-or(Resolve-Path -LiteralPath $target).ProviderPath-cne$target){throw 'Snapshot escaped reviewed root'}
   if((Get-Item -LiteralPath $target -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)-or@(Get-ChildItem -LiteralPath ('\\?\'+$target) -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop).Count){throw 'Linked snapshot child'}
   if((Test-Path -LiteralPath (Join-Path $target '.keep'))-or(Test-Path -LiteralPath (Join-Path $target '.pinned'))){throw 'Snapshot was pinned after planning'}
   if(-not$old.Resume-and(Get-FileHash -LiteralPath (Join-Path $target 'backup.before.json')).Hash-cne$old.MetadataSha256){throw 'Snapshot metadata changed'}
   $journal=@{schema=1;state='pruning';root=$full;path=$target;createdAt=$old.CreatedAt.ToString('o');metadataSha256=$old.MetadataSha256;recoveryPair=$pair;plannedAt=$AsOf.ToString('o')}
   Write-ReleaseRetentionJournal $old.Journal $journal
   $marker=Join-Path $target '.runtime-before.complete'
   if(Test-Path -LiteralPath $marker){Rename-Item -LiteralPath $marker -NewName '.runtime-before.pruning' -ErrorAction Stop}
   Relocation-AssertCold
   if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($target))-cne$full-or(Resolve-Path -LiteralPath $target).ProviderPath-cne$target){throw 'Final deletion path changed'}
   Remove-Item -LiteralPath ('\\?\'+$target) -Recurse -Force -Confirm:$false -ErrorAction Stop
   $journal.state='removed';Write-ReleaseRetentionJournal $old.Journal $journal
   $result+=,@{name=$old.Name;removed=$true}
  }catch{$result+=,@{name=$old.Name;removed=$false;error=$_.Exception.Message}}
 }
 return [pscustomobject]@{Root=$full;RecoveryPair=$pair;Kept=$plan.Keep.Count;Results=$result;Ignored=$plan.Ignored}
}
