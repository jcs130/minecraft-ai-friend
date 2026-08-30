# presence.ps1 - 游戏内角色一键上下线（女神/守卫/灶火村民）
# 用法: .\ops\presence.ps1 off|on|status
# off = 全体下线（GPU 推理请求归零，本地模型歇班）
# on  = 全体上线（守卫先上，反射层就绪后再上女神/村民）
# status = 容器状态 + 服务器在线玩家
# 2026-08-30 造物主需求：方便的打开/关闭方法。
$ErrorActionPreference = 'Continue'

# 角色容器清单（想增删角色改这里）
$ROLE_CONTAINERS_OFF = @('shadow-world', 'shadow-npc', 'shadow-guard')  # 下线顺序：女神先退、村民次之、守卫殿后
$ROLE_CONTAINERS_ON  = @('shadow-guard', 'shadow-npc', 'shadow-world')  # 上线顺序：守卫先进村

function Status {
    Write-Host '=== 角色容器 ===' -ForegroundColor Cyan
    foreach ($c in ($ROLE_CONTAINERS_ON + $ROLE_CONTAINERS_OFF | Select-Object -Unique)) {
        $s = docker ps -a --filter "name=^$c$" --format '{{.Status}}'
        $tag = if ($s -match '^Up') { 'ON ' } else { 'OFF' }
        Write-Host ("  [{0}] {1}  {2}" -f $tag, $c, $s)
    }
    Write-Host '=== 服务器玩家 ===' -ForegroundColor Cyan
    docker exec shadow-mc rcon-cli list 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host '  (rcon-cli 不可用或 MC 未运行)' }
}

switch ($args[0]) {
    'off' {
        Write-Host '>>> 角色全体下线…' -ForegroundColor Yellow
        docker stop $ROLE_CONTAINERS_OFF | ForEach-Object { Write-Host "  stopped: $_" }
        # numen 假玩家身体不随桥断开自动掉线，需显式 dismiss
        foreach ($b in @("Kirito", "Naruto")) {
            $out = docker exec shadow-mc rcon-cli "numen_act dismiss $b" 2>$null
            if ($out -match "dismissed") { Write-Host "  dismissed: $b" }
        }
        Write-Host '>>> 完成。GPU 推理请求已归零，本地模型歇班。' -ForegroundColor Green
        Status
    }
    'on' {
        Write-Host '>>> 角色全体上线（守卫先进村）…' -ForegroundColor Yellow
        docker start $ROLE_CONTAINERS_ON | ForEach-Object { Write-Host "  started: $_" }
        Write-Host '>>> 完成。' -ForegroundColor Green
        Status
    }
    'status' { Status }
    'ai-off' {
        Write-Host '>>> AI 运营下线(QwenPaw 容器栈 + vllm 本地模型)...' -ForegroundColor Yellow
        docker stop shadow-qwenpaw vllm-qwen38-ara-df2 | ForEach-Object { Write-Host "  stopped: $_" }
        Write-Host '>>> 完成。GPU 显存释放, 推理归零(司灯/天神分身/亲卫魂挂起待恢复)。' -ForegroundColor Green
        Status
    }
    'ai-on' {
        Write-Host '>>> AI 运营上线(vllm 先起, QwenPaw 后起)...' -ForegroundColor Yellow
        docker start vllm-qwen38-ara-df2 | ForEach-Object { Write-Host "  started: $_" }
        Write-Host '  等 vllm 健康(最多 120s)...'
        $ok = $false
        foreach ($i in 1..24) { Start-Sleep 5; $s = docker ps --filter 'name=vllm-qwen38-ara-df2' --format '{{.Status}}'; if ($s -match 'healthy') { $ok = $true; break } }
        Write-Host ("  vllm health: " + $(if ($ok) { 'ready' } else { 'timeout-继续(容器可能仍在预热)' }))
        docker start shadow-qwenpaw | ForEach-Object { Write-Host "  started: $_" }
        Write-Host '>>> 完成。' -ForegroundColor Green
    }
    default {
        Write-Host '用法: .\ops\presence.ps1 off|on|status'
        Write-Host '  off    全体下线（女神/守卫/灶火村民）'
        Write-Host '  on     全体上线'
        Write-Host '  status 查看状态'
    }
}
