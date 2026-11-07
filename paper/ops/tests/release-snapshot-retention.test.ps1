$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../release-snapshot-retention.ps1')
$checks=0
function Check($name,$ok){if(-not$ok){throw $name};$script:checks++;Write-Output ('PASS '+$name)}
$asOf=[datetimeoffset]'2026-11-07T20:00:00+08:00'
$rows=@();foreach($n in 0..9){$rows+=,[pscustomobject]@{Name=('sample'+$n);Path=('fixture'+$n);CreatedAt=$asOf.AddHours(-$n);Pinned=$false;Resume=$false}}
$rows+=,[pscustomobject]@{Name='daily';Path='yesterday';CreatedAt=$asOf.AddDays(-1);Pinned=$false;Resume=$false}
$rows+=,[pscustomobject]@{Name='sixth';Path='sixth';CreatedAt=$asOf.AddDays(-6);Pinned=$false;Resume=$false}
$rows+=,[pscustomobject]@{Name='old';Path='old';CreatedAt=$asOf.AddDays(-7);Pinned=$false;Resume=$false}
$rows+=,[pscustomobject]@{Name='pin';Path='pinned';CreatedAt=$asOf.AddDays(-100);Pinned=$true;Resume=$false}
$kept=@(Select-ReleaseSnapshotKeep $rows $asOf)
foreach($name in @('fixture0','fixture1','fixture2','yesterday','sixth','pinned')){Check ('retain '+$name) ($kept-contains$name)}
Check 'duplicates within a day expire' ($kept-notcontains'fixture3')
Check 'calendar cutoff expires' ($kept-notcontains'old')
Check 'exact recovery window' ($kept.Count-eq 6)
Check 'empty plans work' (@(Select-ReleaseSnapshotKeep @() $asOf).Count-eq 0)

$temp=[IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('qd-release-retention-'+[guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $temp|Out-Null
[IO.File]::WriteAllText((Join-Path $temp 'FIXTURE_ONLY'),'isolated retention test')
try{
 $name='fixture-before-refresh-20261020-r1';$folder=Join-Path $temp $name
 foreach($dir in @('server\world','ysm-private')){New-Item -ItemType Directory -Path (Join-Path $folder $dir) -Force|Out-Null}
 foreach($file in @('server\server.jar','server\world\level.dat','.runtime-before.complete')){[IO.File]::WriteAllText((Join-Path $folder $file),'fixture')}
 $meta=@{source='E:\MC\server';stoppedForCopy=$true;createdAt='2026-10-20T12:00:00+08:00';serverJarSha256=('a'*64)}
 $meta|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $folder 'backup.before.json') -Encoding UTF8
 $p=Get-ReleaseSnapshotPlan $temp $asOf
 Check 'single old complete recovery point retained as recent' ($p.Keep.Count-eq 1-and$p.Expired.Count-eq 0)
 $meta.stoppedForCopy=$false;$meta|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $folder 'backup.before.json') -Encoding UTF8
 $p=Get-ReleaseSnapshotPlan $temp $asOf
 Check 'unknown backup metadata is never deleted' ($p.Keep.Count-eq 0-and$p.Expired.Count-eq 0-and$p.Ignored.Count-eq 1)
 $meta.stoppedForCopy=$true;$meta.createdAt='2027-01-01T12:00:00+08:00';$meta|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $folder 'backup.before.json') -Encoding UTF8
 Check 'future timestamp is ignored' ((Get-ReleaseSnapshotPlan $temp $asOf).Ignored.Count-eq 1)
 Remove-Item -LiteralPath (Join-Path $folder '.runtime-before.complete')
 Check 'unmarked partial backup is preserved' ((Get-ReleaseSnapshotPlan $temp $asOf).Expired.Count-eq 0)
 $journal=Join-Path $temp '.release-retention';New-Item -ItemType Directory -Path $journal|Out-Null
 $state=@{schema=1;state='pruning';root=$temp;path=$folder;createdAt='2026-10-20T12:00:00+08:00';metadataSha256=('a'*64)}
 Write-ReleaseRetentionJournal (Join-Path $journal ($name+'.json')) $state
 Check 'interrupted deletion resumes only with matching durable journal' ((Get-ReleaseSnapshotPlan $temp $asOf).Expired.Count-eq 1)
 [IO.File]::WriteAllText((Join-Path $folder '.keep'),'pin')
 Check 'a new pin prevents resuming deletion' ((Get-ReleaseSnapshotPlan $temp $asOf).Expired.Count-eq 0)
 $state.path='C:\Windows';Write-ReleaseRetentionJournal (Join-Path $journal ($name+'.json')) $state
 Check 'mismatched journal cannot authorize deletion' ((Get-ReleaseSnapshotPlan $temp $asOf).Ignored.Count-eq 1)
 $rejected=$false;try{Invoke-ReleaseSnapshotRetention -BackupRoot $temp}catch{$rejected=$_.Exception.Message-eq'Unreviewed release backup root'}
 Check 'executor refuses nonproduction roots before touching contents' $rejected
}finally{
 if([IO.Path]::GetDirectoryName($temp)-cne[IO.Path]::GetTempPath().TrimEnd('\')-or-not(Test-Path -LiteralPath (Join-Path $temp 'FIXTURE_ONLY'))){throw 'Unsafe test cleanup'}
 Remove-Item -LiteralPath $temp -Recurse -Force
}

& {
 function Get-Item {return [pscustomobject]@{Attributes=[IO.FileAttributes]::Directory}}
 function Get-ReleaseSnapshotPlan {return [pscustomobject]@{Expired=@();Keep=@();Ignored=@()}}
 function Relocation-AssertCold {throw 'SYNTHETIC_GAME_ONLINE'}
 $blocked=$false;try{Invoke-ReleaseSnapshotRetention -BackupRoot 'E:\MC\backups'}catch{$blocked=$_.Exception.Message-eq'SYNTHETIC_GAME_ONLINE'}
 Check 'running game blocks even an empty cleanup before recovery or writes' $blocked
}
& {
 # Virtual filesystem for destructive executor faults. No real production
 # command is reachable in this scope, including Remove-Item and journal I/O.
 $fakeName='fixture-before-refresh-20261001-r1'
 $fake=[pscustomobject]@{Name=$fakeName;Path=('E:\MC\backups\'+$fakeName);CreatedAt=$asOf.AddDays(-30);Pinned=$false;Resume=$false;MetadataSha256=('A'*64);Journal=('E:\MC\backups\.release-retention\'+$fakeName+'.json')}
 $events=[Collections.Generic.List[string]]::new();$fault=''
 function Get-Item {return [pscustomobject]@{Attributes=[IO.FileAttributes]::Directory}}
 function Get-ReleaseSnapshotPlan {return [pscustomobject]@{Expired=@($fake);Keep=@('retained');Ignored=@()}}
 function Relocation-AssertCold {$events.Add('cold')}
 function Assert-ReleaseRecoveryPair {if($fault-eq'pair'){throw 'BAD_PAIR'};return '20261107-040000'}
 function Resolve-Path {param($LiteralPath)return [pscustomobject]@{ProviderPath=$LiteralPath}}
 function Get-ChildItem {if($fault-eq'link'){return [pscustomobject]@{link=$true}}}
 function Test-Path {param($LiteralPath)return ($LiteralPath.EndsWith('.release-retention')-or$LiteralPath.EndsWith('.runtime-before.complete')-or($fault-eq'pin'-and$LiteralPath.EndsWith('.keep')))}
 function Get-FileHash {return [pscustomobject]@{Hash=if($fault-eq'metadata'){'B'*64}else{'A'*64}}}
 function Write-ReleaseRetentionJournal {param($Path,$Value)$events.Add('journal-'+$Value.state);if($fault-eq'journal'){throw 'JOURNAL_DISK_FAILURE'}}
 function Rename-Item {$events.Add('withdraw-complete')}
 function Remove-Item {$events.Add('delete');if($fault-eq'delete'){throw 'DELETE_FAILURE'}}
 function New-Item {throw 'Unexpected directory write in virtual fixture'}
 $r=Invoke-ReleaseSnapshotRetention -BackupRoot 'E:\MC\backups' -AsOf $asOf
 Check 'normal cleanup commits completion after deletion' ($r.Results[0].removed-and$events.IndexOf('journal-removed')-gt$events.IndexOf('delete'))
 Check 'durable intent precedes withdrawing complete marker and deletion' ($events.IndexOf('journal-pruning')-lt$events.IndexOf('withdraw-complete')-and$events.IndexOf('withdraw-complete')-lt$events.IndexOf('delete'))
 foreach($mode in @('journal','metadata','pin','link')){
  $fault=$mode;$events.Clear();$r=Invoke-ReleaseSnapshotRetention -BackupRoot 'E:\MC\backups' -AsOf $asOf
  Check ($mode+' failure prevents deletion') (-not$r.Results[0].removed-and-not$events.Contains('delete'))
 }
 $fault='delete';$events.Clear();$r=Invoke-ReleaseSnapshotRetention -BackupRoot 'E:\MC\backups' -AsOf $asOf
 Check 'partial deletion retains durable pruning intent' (-not$r.Results[0].removed-and$events.Contains('journal-pruning')-and-not$events.Contains('journal-removed'))
 $fault='';$fake.Resume=$true;$events.Clear();$r=Invoke-ReleaseSnapshotRetention -BackupRoot 'E:\MC\backups' -AsOf $asOf
 Check 'reviewed interrupted deletion can finish' $r.Results[0].removed
 $fault='pair';$events.Clear();$blocked=$false;try{Invoke-ReleaseSnapshotRetention -BackupRoot 'E:\MC\backups' -AsOf $asOf}catch{$blocked=$_.Exception.Message-eq'BAD_PAIR'}
 Check 'bad recovery pair prevents all deletion' ($blocked-and-not$events.Contains('delete'))
 $fault='';$fake.Path='E:\MC\server';$events.Clear();$r=Invoke-ReleaseSnapshotRetention -BackupRoot 'E:\MC\backups' -AsOf $asOf
 Check 'escaped planned path cannot be deleted' (-not$r.Results[0].removed-and-not$events.Contains('delete'))
}
Write-Output ('Release snapshot retention: '+$checks+' checks passed; production unchanged')
