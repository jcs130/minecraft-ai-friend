param(
    [string]$Role='悠怡',
    [string]$Launcher
)
$ErrorActionPreference='Stop'
$utf8=[Text.UTF8Encoding]::new($false)
$dir=$PSScriptRoot
$trial=Get-Content -Encoding utf8 -Raw -LiteralPath (Join-Path $dir 'trial.json') |ConvertFrom-Json
if ([datetimeoffset]::Now -ge [datetimeoffset]::Parse($trial.expiresAt)) {throw '这次托管已到期。'}
if ([string]::IsNullOrWhiteSpace($Role) -or $Role.Trim() -cne $Role) {throw '请填写原来 N.E.K.O. 中显示的角色名。'}
$ca=Join-Path $dir 'website-ca.pem'
$endpoint=$trial.address+'/api/v1/maid-body'
$portal='https://mc.kangqiang.site'
$site= & curl.exe --disable --silent --show-error --fail --max-time 8 --ssl-revoke-best-effort --cacert $ca ($portal+'/api/v1/maid-connect/trial')
if($LASTEXITCODE -ne 0 -or -not (($site -join '')|ConvertFrom-Json).active){throw '官网临时托管当前不可用。'}
$code=& curl.exe --disable --silent --show-error --max-time 8 --noproxy '*' --ssl-revoke-best-effort --cacert $ca --output NUL --write-out '%{http_code}' --header 'Content-Type: application/json' --data '{}' $endpoint
if($LASTEXITCODE -ne 0 -or $code -ne '401'){throw '无法确认局域网身体入口，请连接服务器所在的家庭网络。'}
$config=Join-Path $dir 'body.json'
$data=[ordered]@{schema_version=1;role=$Role;owner_id=$trial.ownerId;maid_id=$trial.maidId;ca_file=$ca;forward_owner_dialogue=$true;portal_origin=$portal}
[IO.File]::WriteAllText($config,($data |ConvertTo-Json),$utf8)
$env:QIANDENGJI_NEKO_MAID_CONFIG=$config
Write-Output ('官网与局域网已就绪。此窗口已为「'+$Role+'」设置 '+$config)
if ($Launcher){
    $exe=Get-Item -LiteralPath $Launcher -ErrorAction Stop
    if ($exe.PSIsContainer){throw '请指定原启动程序的文件路径。'}
    Start-Process -FilePath $exe.FullName -WorkingDirectory $exe.Directory.FullName
}else{
    Write-Output '请在这个 PowerShell 窗口运行原来的 N.E.K.O. 启动命令，然后打开酒狐 → 官网授权。'
}
