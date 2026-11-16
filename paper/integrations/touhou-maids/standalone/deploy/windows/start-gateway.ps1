$ErrorActionPreference='Stop'
$stamp=(Get-Date -Format 'yyyyMMdd-HHmmssfff')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$worker=Start-Process -FilePath 'E:/MC/runtime/python-3.12.14/python.exe' -ArgumentList @('-X','utf8','-B','E:/MC/runtime/aincrad-residents-0.3.0-20261116/gateway/dsh_gateway.py','E:/MC/private/aincrad-residents/gateway.json') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput ('E:/MC/private/aincrad-residents/gateway.'+$stamp+'.stdout.log') -RedirectStandardError ('E:/MC/private/aincrad-residents/gateway.'+$stamp+'.stderr.log')
exit $worker.ExitCode
