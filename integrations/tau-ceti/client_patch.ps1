param([string]$MinecraftDir, [switch]$Plan)
$ErrorActionPreference='Stop'
if(-not $MinecraftDir){$MinecraftDir=Read-Host '请选择已导入官方 Tau 1.3.2 的实例，填写其中 .minecraft 目录的完整路径'}
$mcRoot=[IO.Path]::GetFullPath($MinecraftDir)
$mcMods=Join-Path $mcRoot 'mods'
if(-not (Test-Path -LiteralPath $mcMods -PathType Container)){throw '目标必须是已有 Tau 整合包的 .minecraft 目录。'}
if(-not(Test-Path -LiteralPath (Join-Path $mcRoot 'kubejs/startup_scripts/tauceti/init.js'))){throw '没有找到官方 Tau 启动脚本；请新建并导入 Tau 1.3.2 实例后再安装补丁。'}
$mcRunning=Get-CimInstance Win32_Process -Filter "Name='java.exe' OR Name='javaw.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($mcRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0 }
if($mcRunning){throw '请先正常退出这个 Minecraft 实例，再更新。'}
$mcManifestPath=Join-Path $PSScriptRoot 'client-patch-manifest.json'
$mcManifestExpected='3fad42f7853f311cc34c1a9c09cc8709d440b829f266502d18da40e9d10ff636'
if(Test-Path -LiteralPath $mcManifestPath){$mcManifestText=Get-Content -LiteralPath $mcManifestPath -Raw -Encoding UTF8}
else{$mcResponse=Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/jcs130/minecraft-ai-friend/feat/tau-ceti-and-aincrad-20261026/integrations/tau-ceti/client-patch-manifest.json' -TimeoutSec 30;$mcManifestText=if($mcResponse.Content -is [byte[]]){[Text.Encoding]::UTF8.GetString($mcResponse.Content)}else{[string]$mcResponse.Content}}
$mcManifestCanonical=$mcManifestText.TrimStart([char]0xfeff).Replace("`r`n","`n")
$mcDigest=[Security.Cryptography.SHA256]::Create()
try{$mcActualHash=([BitConverter]::ToString($mcDigest.ComputeHash([Text.Encoding]::UTF8.GetBytes($mcManifestCanonical)))).Replace('-','').ToLowerInvariant()}finally{$mcDigest.Dispose()}
if($mcActualHash -ne $mcManifestExpected){throw '补丁与清单版本不匹配，请重新下载同一版本；原实例没有修改。'}
$mcManifest=$mcManifestCanonical | ConvertFrom-Json
if($mcManifest.schemaVersion -ne 1 -or $mcManifest.files.Count -gt 100){throw '补丁清单格式或预算不符。'}
foreach($mcEntry in $mcManifest.files){
  if($mcEntry.name -notmatch '^[^/\\:*?"<>|]+\.jar$' -or $mcEntry.sha256 -notmatch '^[0-9a-f]{64}$' -or $mcEntry.url -notmatch '^https://cdn\.modrinth\.com/') {throw '补丁来源、文件名或摘要不符。'}
}
if($Plan){$mcManifest.files | Select-Object name,bytes;Write-Output '仅显示计划；未写入文件。';exit 0}
$mcOperation=[Guid]::NewGuid().ToString('N')
$mcStaging=Join-Path $mcRoot ('.maw-download-'+$mcOperation)
$mcBackup=Join-Path $mcRoot ('maw-backup-'+$mcOperation)
New-Item -ItemType Directory -Path $mcStaging,$mcBackup | Out-Null
# Finish and verify every download before changing the installed mod set.
foreach($mcEntry in $mcManifest.files){
  $mcDownload=Join-Path $mcStaging $mcEntry.name
  Write-Output ('下载 '+$mcEntry.name)
  Invoke-WebRequest -UseBasicParsing -Uri $mcEntry.url -OutFile $mcDownload -TimeoutSec 120
  if((Get-FileHash -LiteralPath $mcDownload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $mcEntry.sha256){throw ('校验失败，原实例未修改：'+$mcEntry.name)}
}
$mcOld=Get-ChildItem -LiteralPath $mcMods -File -Filter '*.jar' | Where-Object {
  $_.Name -match '^(sodium[-_]|sodiumoptions|iris|oculus|reeses[-_]sodium|reeses_sodium|sodiumextra)' -or $_.Name -in $mcManifest.files.name
}
$mcMoved=@();$mcInstalled=@()
try {
  foreach($mcFile in $mcOld){
    $mcSource=[IO.Path]::GetFullPath($mcFile.FullName)
    if(-not $mcSource.StartsWith([IO.Path]::GetFullPath($mcMods)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '旧文件不在选定实例内。'}
    Move-Item -LiteralPath $mcSource -Destination (Join-Path $mcBackup $mcFile.Name)
    $mcMoved+=$mcFile.Name
  }
  foreach($mcEntry in $mcManifest.files){
    $mcTarget=Join-Path $mcMods $mcEntry.name
    if(Test-Path -LiteralPath $mcTarget){throw ('目标存在，停止覆盖：'+$mcEntry.name)}
    $mcInstalled+=$mcEntry.name
    Copy-Item -LiteralPath (Join-Path $mcStaging $mcEntry.name) -Destination $mcTarget
  }
} catch {
  # Move only files this operation installed; no recursive deletion or scripts.
  $mcFailed=Join-Path $mcStaging 'failed-install';New-Item -ItemType Directory -Path $mcFailed | Out-Null
  foreach($mcName in $mcInstalled){if(Test-Path -LiteralPath (Join-Path $mcMods $mcName)){Move-Item -LiteralPath (Join-Path $mcMods $mcName) -Destination (Join-Path $mcFailed $mcName)}}
  foreach($mcName in $mcMoved){Move-Item -LiteralPath (Join-Path $mcBackup $mcName) -Destination (Join-Path $mcMods $mcName)}
  throw
}
@{schemaVersion=1;completedAt=[DateTimeOffset]::UtcNow.ToString('o');files=$mcManifest.files;backup=$mcBackup;removedFromActive=$mcMoved} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $mcRoot 'maw-client-patch.json') -Encoding UTF8
Write-Output ('补丁完成。原文件保存在 '+$mcBackup)
Write-Output '游戏 1.21.1 / NeoForge 21.1.234。测试服地址 micro.kangqiang.site:28976。'
Write-Output '首次离线登录：/register 密码 再输一次；以后 /login 密码。密码至少八位。'
