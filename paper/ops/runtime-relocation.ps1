# One-shot relocation, called only by the original stopped E/F backup flow.
# Existing E: paths remain as junctions; originals are retained for rollback.
function Relocation-ExpectedMoves {
    @(
        @{source='E:\MC\server';target='C:\MC-active\paper';retained='E:\MC\server.pre-nvme-20261029';backup='server'},
        @{source='E:\MC\private\ysm';target='C:\MC-active\ysm';retained='E:\MC\private\ysm.pre-nvme-20261029';backup='ysm-private'}
    )
}

function Relocation-ValidatePlan($plan) {
    if ($plan.schemaVersion -ne 1 -or $plan.releaseId -cne 'nvme-runtime-20261029' -or
        @($plan.moves).Count -ne 2 -or $plan.minimumFreeGiB -ne 80) { throw 'Unsupported runtime relocation plan.' }
    $expected=@(Relocation-ExpectedMoves)
    for($index=0;$index -lt 2;$index++) {
        foreach($field in @('source','target','retained','backup')) {
            if ($plan.moves[$index].$field -cne $expected[$index][$field]) { throw "Unexpected runtime relocation $field." }
        }
    }
    $requested=[datetimeoffset]::Parse([string]$plan.requestedAt)
    if($requested -gt [datetimeoffset]::Now.AddMinutes(5) -or $requested -lt [datetimeoffset]::Now.AddHours(-12)) { throw 'Relocation authorization is stale.' }
    return $plan
}

function Relocation-TransientSqlite([IO.FileInfo]$file) {
    if($file.Name -notmatch '-(shm|wal)$') { return $false }
    $suffix=$Matches[1]
    if($suffix -eq 'wal' -and $file.Length -ne 0) { return $false }
    $database=$file.FullName.Substring(0,$file.FullName.Length-4)
    if(-not [IO.File]::Exists($database)) { return $false }
    $stream=$null
    try {
        $stream=[IO.File]::Open($database,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        $header=New-Object byte[] 16
        $count=$stream.Read($header,0,16)
        return $count -eq 16 -and [Text.Encoding]::ASCII.GetString($header) -ceq "SQLite format 3`0"
    } catch { return $false }
    finally { if($stream) { $stream.Dispose() } }
}

function Relocation-Tree([string]$path) {
    $full=[IO.Path]::GetFullPath($path).TrimEnd('\')
    $item=Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if(-not $item.PSIsContainer -or $item.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Relocation requires an ordinary source directory.' }
    $links=@(Get-ChildItem -LiteralPath ('\\?\'+$full) -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop)
    if($links.Count) { throw 'Linked runtime children require separate inspection.' }
    $rows=@(Get-ChildItem -LiteralPath ('\\?\'+$full) -Recurse -Force -File -ErrorAction Stop | ForEach-Object {
        # Read-only SQLite clients can create SHM and an empty WAL after the
        # writer closed. SHM is derived; a nonempty WAL always remains data.
        if(Relocation-TransientSqlite $_) { return }
        $file=$_.FullName -replace '^\\\\\?\\',''
        if(-not $file.StartsWith($full+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'File escaped runtime root.' }
        [pscustomobject]@{path=$file.Substring($full.Length+1);bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
    } | Sort-Object path)
    return $rows
}

function Relocation-Compare($before,$after) {
    if(@($before).Count -ne @($after).Count) { throw "Runtime persistent file count changed: $(@($before).Count) -> $(@($after).Count)." }
    for($index=0;$index -lt @($before).Count;$index++) {
        foreach($field in @('path','bytes','sha256')) {
            if($before[$index].$field -cne $after[$index].$field) { throw "Runtime $field mismatch at $($before[$index].path)." }
        }
    }
}

function Relocation-Access([string]$path) {
    @((Get-Acl -LiteralPath $path -ErrorAction Stop).Access | ForEach-Object {
        '{0}|{1}|{2}|{3}|{4}' -f $_.IdentityReference.Value,[int64]$_.FileSystemRights,$_.AccessControlType,$_.InheritanceFlags,$_.PropagationFlags
    } | Sort-Object)
}

function Relocation-CopyAccess([string]$source,[string]$target) {
    $sourceIsDirectory=(Get-Item -LiteralPath $source -Force).PSIsContainer
    if($sourceIsDirectory -ne (Get-Item -LiteralPath $target -Force).PSIsContainer) { throw 'Access cloning requires matching item types.' }
    $acl=if($sourceIsDirectory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
    $accessOnly=[Security.AccessControl.AccessControlSections]::Access
    $acl.SetSecurityDescriptorSddlForm((Get-Acl -LiteralPath $source).GetSecurityDescriptorSddlForm($accessOnly),$accessOnly)
    # Moved files can retain inherited ACEs from a previous parent. Restoring
    # an unprotected DACL re-inherits from C: and loses those restrictions.
    # Freeze the original effective entries; never inherit broader C: rules.
    $acl.SetAccessRuleProtection($true,$true)
    Set-Acl -LiteralPath $target -AclObject $acl -ErrorAction Stop
    if(@(Compare-Object -ReferenceObject @(Relocation-Access $source) -DifferenceObject @(Relocation-Access $target)).Count) { throw 'NVMe access differs from the original.' }
}

function Relocation-NewPrivateTarget([string]$target) {
    New-Item -ItemType Directory -Path $target -ErrorAction Stop | Out-Null
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $sids=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544') | Select-Object -Unique
    foreach($sid in $sids) {
        $identity=[Security.Principal.SecurityIdentifier]::new($sid)
        $rule=[Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit, ObjectInherit','None','Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $target -AclObject $acl -ErrorAction Stop
}

function Relocation-AssertCold {
    foreach($port in @(25565,25581,25582,25583,25584)) {
        if(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            throw 'Runtime relocation requires Paper, proxy, worker and supervisor to be stopped.'
        }
    }
}

function Relocation-Snapshot([string]$path,[string]$root,[datetimeoffset]$requested) {
    $full=[IO.Path]::GetFullPath($path).TrimEnd('\')
    if([IO.Path]::GetDirectoryName($full) -cne $root -or [IO.Path]::GetFileName($full) -notmatch '^\d{8}-\d{6}$' -or
        -not (Test-Path -LiteralPath (Join-Path $full '.complete'))) { throw 'Expected a complete native backup under the fixed root.' }
    $meta=Get-Content -LiteralPath (Join-Path $full 'backup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if(-not $meta.stoppedForCopy -or [datetimeoffset]::Parse($meta.createdAt) -lt $requested) { throw 'Runtime relocation requires this maintenance cold backup.' }
    return $full
}

function Deploy-PendingRuntimeRelocation([string]$backup,[string]$mirror) {
    $pending=Join-Path $opsDir 'runtime-relocation.pending.json'
    if(-not (Test-Path -LiteralPath $pending)) { return }
    $plan=Relocation-ValidatePlan (Get-Content -LiteralPath $pending -Raw -Encoding UTF8 | ConvertFrom-Json)
    $requested=[datetimeoffset]::Parse($plan.requestedAt)
    Relocation-AssertCold
    $a=Relocation-Snapshot $backup 'E:\MC\backups\scheduled' $requested
    $b=Relocation-Snapshot $mirror 'F:\MC-backups\scheduled' $requested
    if([IO.Path]::GetFileName($a) -cne [IO.Path]::GetFileName($b)) { throw 'Runtime recovery snapshots differ.' }
    $partition=Get-Partition -DriveLetter C -ErrorAction Stop
    if((Get-Disk -Number $partition.DiskNumber -ErrorAction Stop).BusType -ne 'NVMe') { throw 'C: is not the expected NVMe volume.' }
    $available=(Get-PSDrive C).Free
    $evidence=Join-Path $opsDir 'repairs\nvme-runtime-20261029-r7'
    New-Item -ItemType Directory -Path $evidence -Force | Out-Null
    $otherEvidence='F:\MC-backups\repairs\nvme-runtime-20261029-r7'
    New-Item -ItemType Directory -Path $otherEvidence -Force | Out-Null
    $blocked=Join-Path $opsDir 'runtime-relocation.recovery.blocked'
    if(Test-Path -LiteralPath $blocked) { throw 'A previous runtime relocation requires inspection.' }
    $journal=[ordered]@{releaseId=$plan.releaseId;startedAt=(Get-Date).ToString('o');phase='checking';backup=[IO.Path]::GetFileName($a);moves=@();passwordsChanged=$false}
    $moved=@()
    function Save-Relocation {
        $json=$journal | ConvertTo-Json -Depth 7
        foreach($out in @($evidence,$otherEvidence)) {
            [IO.File]::WriteAllText((Join-Path $out 'transaction.json'),$json,[Text.UTF8Encoding]::new($false))
        }
    }
    try {
        $sources=@();$total=0L
        foreach($move in $plan.moves) {
            if(Test-Path -LiteralPath $move.target) { throw 'NVMe destination already exists; inspect rather than overwrite.' }
            if(Test-Path -LiteralPath $move.retained) { throw 'Retained source already exists; do not replay relocation.' }
            $rows=@(Relocation-Tree $move.source);$total+=($rows | Measure-Object bytes -Sum).Sum
            if($move.backup -eq 'server') {
                Relocation-Compare $rows @(Relocation-Tree (Join-Path $a 'server'))
                Relocation-Compare $rows @(Relocation-Tree (Join-Path $b 'server'))
            } else {
                foreach($relative in @('proxy\velocity.toml','proxy\plugins\LibreLogin\user-data.db','proxy\plugins\agentappearance\models.json','worker\server.properties')) {
                    $hash=(Get-FileHash -LiteralPath (Join-Path $move.source $relative) -Algorithm SHA256).Hash
                    foreach($copy in @($a,$b)) {
                        if((Get-FileHash -LiteralPath (Join-Path (Join-Path $copy 'ysm-private') $relative) -Algorithm SHA256).Hash -cne $hash) { throw 'Private service backup mismatch.' }
                    }
                }
            }
            $sources+=,@($rows)
        }
        if($available -lt $total+($plan.minimumFreeGiB*1GB)) { throw 'NVMe does not have enough room plus the reserved system space.' }
        foreach($copy in @($a,$b)) { [IO.File]::WriteAllText((Join-Path $copy '.keep'),'Pre-NVMe runtime relocation recovery point; retain world, bank and authentication together.') }
        $parent='C:\MC-active'
        if(-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        if((Get-Item -LiteralPath $parent -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'NVMe parent cannot itself be a link.' }
        for($index=0;$index -lt 2;$index++) {
            $move=$plan.moves[$index]
            # Copy data into a private target. Preserve the original DACL
            # export as evidence, then freeze each item's effective access.
            Relocation-NewPrivateTarget $move.target
            $accessFile=Join-Path $evidence ('access-'+$index+'.txt')
            $accessLog=Join-Path $evidence ('access-'+$index+'.log')
            & icacls.exe ($move.source+'\*') /save $accessFile /t /q > $accessLog 2>&1
            if($LASTEXITCODE -ne 0) { throw 'Runtime access export failed before copying.' }
            & robocopy.exe $move.source $move.target /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
            if($LASTEXITCODE -ge 8) { throw 'NVMe runtime copy failed; originals retained.' }
            Relocation-Compare $sources[$index] @(Relocation-Tree $move.target)
            $items=@(Get-ChildItem -LiteralPath $move.source -Recurse -Force -ErrorAction Stop | Sort-Object {$_.FullName.Length} -Descending)
            foreach($item in $items) {
                if(-not $item.PSIsContainer -and (Relocation-TransientSqlite $item)) { continue }
                $relative=$item.FullName.Substring($move.source.Length+1)
                try { Relocation-CopyAccess $item.FullName (Join-Path $move.target $relative) }
                catch { throw "Runtime access could not be preserved at $relative : $($_.Exception.Message)" }
            }
            # Children are protected before changing parents or the root.
            Relocation-CopyAccess $move.source $move.target
            Copy-Item -LiteralPath $accessFile -Destination (Join-Path $otherEvidence ([IO.Path]::GetFileName($accessFile))) -ErrorAction Stop
            $journal.moves+=@{source=$move.source;target=$move.target;retained=$move.retained;files=$sources[$index].Count;bytes=($sources[$index] | Measure-Object bytes -Sum).Sum}
            Save-Relocation
        }
        # Recheck original bytes immediately before swapping the path names.
        for($index=0;$index -lt 2;$index++) { Relocation-Compare $sources[$index] @(Relocation-Tree $plan.moves[$index].source) }
        Relocation-AssertCold
        New-Item -ItemType File -Path $blocked -ErrorAction Stop | Out-Null
        $journal.phase='swapping';Save-Relocation
        foreach($move in $plan.moves) {
            # Both names are fixed, resolved siblings; no recursive move/delete.
            Rename-Item -LiteralPath $move.source -NewName ([IO.Path]::GetFileName($move.retained)) -ErrorAction Stop
            $moved+=,$move
            New-Item -ItemType Junction -Path $move.source -Target $move.target -ErrorAction Stop | Out-Null
            $link=Get-Item -LiteralPath $move.source -Force
            if(-not $link.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or @($link.Target)[0].TrimEnd('\') -cne $move.target) { throw 'Runtime junction does not resolve to the reviewed NVMe target.' }
        }
        $journal.phase='committed';$journal.finishedAt=(Get-Date).ToString('o');Save-Relocation
        Move-Item -LiteralPath $pending -Destination (Join-Path $evidence 'request.completed.json') -ErrorAction Stop
        Remove-Item -LiteralPath $blocked -Force -ErrorAction Stop
        Log 'NVMe runtime relocation committed; E: aliases preserved and original directories retained.'
    } catch {
        $failure=$_
        try {
            foreach($move in @($moved | Sort-Object source -Descending)) {
                if(Test-Path -LiteralPath $move.source) {
                    $link=Get-Item -LiteralPath $move.source -Force
                    if(-not $link.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or @($link.Target)[0].TrimEnd('\') -cne $move.target) { throw 'Unexpected runtime path; automatic rollback blocked.' }
                    [IO.Directory]::Delete($move.source) # Delete the verified junction only, never its target.
                }
                if([IO.Path]::GetDirectoryName($move.retained) -cne [IO.Path]::GetDirectoryName($move.source)) { throw 'Retained runtime path escaped its parent.' }
                Rename-Item -LiteralPath $move.retained -NewName ([IO.Path]::GetFileName($move.source)) -ErrorAction Stop
            }
            $journal.phase='rolled-back';$journal.failure=$failure.Exception.GetType().Name;Save-Relocation
            if(Test-Path -LiteralPath $blocked) { Remove-Item -LiteralPath $blocked -Force -ErrorAction Stop }
            if(Test-Path -LiteralPath $pending) { Move-Item -LiteralPath $pending -Destination (Join-Path $evidence 'request.failed.json') -ErrorAction Stop }
        } catch {
            if(-not (Test-Path -LiteralPath $blocked)) { New-Item -ItemType File -Path $blocked | Out-Null }
            throw 'Runtime relocation rollback needs inspection; automatic startup is blocked.'
        }
        throw $failure
    }
}
