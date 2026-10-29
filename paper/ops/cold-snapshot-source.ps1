# Resolve only an operator-approved snapshot root. Relocation-Tree itself stays
# strict: its ordinary-directory and linked-child checks must not be weakened.
function Resolve-ColdSnapshotSource([string]$path,[string]$expectedPhysicalRoot) {
    $full=[IO.Path]::GetFullPath($path).TrimEnd('\')
    $expected=[IO.Path]::GetFullPath($expectedPhysicalRoot).TrimEnd('\')
    $item=Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if(-not $item.PSIsContainer){throw 'Cold snapshot source is not a directory.'}
    if($item.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){
        $targets=@($item.Target)
        if($item.LinkType -cne 'Junction' -or $targets.Count -ne 1){throw 'Cold snapshot requires the approved directory junction.'}
        $resolved=[IO.Path]::GetFullPath([string]$targets[0]).TrimEnd('\')
    }else{$resolved=$full}
    if(-not $resolved.Equals($expected,[StringComparison]::OrdinalIgnoreCase)){throw 'Cold snapshot junction differs from its approved physical root.'}
    $physical=Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
    if(-not $physical.PSIsContainer -or $physical.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'Cold snapshot physical root must be an ordinary directory.'}
    $ancestor=[IO.Directory]::GetParent($resolved)
    while($ancestor){
        if((Get-Item -LiteralPath $ancestor.FullName -Force -ErrorAction Stop).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'Cold snapshot physical ancestors cannot be links.'}
        $ancestor=$ancestor.Parent
    }
    return $resolved
}
