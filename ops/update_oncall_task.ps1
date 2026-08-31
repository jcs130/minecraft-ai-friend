$diag = 'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\data\oncall_diag.log'
"ps1 $(Get-Date -Format o) HOMEbefore=[$env:PYTHONHOME]" | Out-File -FilePath $diag -Encoding utf8
Remove-Item Env:\PYTHONHOME -ErrorAction SilentlyContinue
Remove-Item Env:\PYTHONPATH -ErrorAction SilentlyContinue
$py = 'C:\Users\lzl19\AppData\Local\Programs\Python\Python313\python.exe'
$s = 'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\mc_oncall.py'
$p = Start-Process -FilePath $py -ArgumentList "`"$s`"" -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardError 'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\data\oncall_err.tmp'
"python exitcode=$($p.ExitCode)" | Out-File -FilePath $diag -Append -Encoding utf8
