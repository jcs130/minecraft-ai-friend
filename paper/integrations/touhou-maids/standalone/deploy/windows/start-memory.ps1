$ErrorActionPreference='Stop'
$env:MAID_POWERCONTEXT_KEY=[IO.File]::ReadAllText('E:/MC/private/aincrad-residents/powercontext.token').Trim()
$stamp=(Get-Date -Format 'yyyyMMdd-HHmmssfff')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$worker=Start-Process -FilePath 'C:/Users/lzl19/AppData/Local/hermes/node/node.exe' -ArgumentList @('E:/MC/runtime/aincrad-residents-0.3.0-20261116/companion-memory.mjs','E:/MC/private/aincrad-residents/memory.json') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput ('E:/MC/private/aincrad-residents/memory.'+$stamp+'.stdout.log') -RedirectStandardError ('E:/MC/private/aincrad-residents/memory.'+$stamp+'.stderr.log')
exit $worker.ExitCode
