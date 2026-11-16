$ErrorActionPreference='Stop'
$env:MAID_POWERCONTEXT_KEY=[IO.File]::ReadAllText('E:/MC/private/aincrad-residents/powercontext.token').Trim()
$worker=Start-Process -FilePath 'C:/Users/lzl19/AppData/Local/hermes/node/node.exe' -ArgumentList @('E:/MC/runtime/aincrad-residents-0.3.0-20261116/companion-memory.mjs','E:/MC/private/aincrad-residents/memory.json') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput 'E:/MC/private/aincrad-residents/memory.log' -RedirectStandardError 'E:/MC/private/aincrad-residents/memory.stderr.log'
exit $worker.ExitCode
