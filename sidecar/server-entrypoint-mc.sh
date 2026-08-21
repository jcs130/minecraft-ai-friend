#!/bin/sh
# MC java 服务端容器入口（NeoForge 21.1.233 + numen + settlements）
# 数据源 = numen-sandbox/（mods/config/world/libraries/versions），由 compose bind mount 到 /app/mc-server
# 职责：启动前固化 server.properties 的端口与 RCON（世界进程唯一 RCON 持有者），再起 java
set -u
cd /app/mc-server

# 1) server.properties 固化（幂等）：内网固定口 25599 + RCON 25575 开启
if [ -f server.properties ]; then
  # 端口：内网固定 25599（皮肤代理前门 25565 -> 这里）
  if grep -q '^server-port=' server.properties; then
    sed -i 's/^server-port=.*/server-port=25599/' server.properties
  else
    echo 'server-port=25599' >> server.properties
  fi
  # RCON 开启 + 端口 + 密码
  if grep -q '^enable-rcon=' server.properties; then
    sed -i 's/^enable-rcon=.*/enable-rcon=true/' server.properties
  else
    echo 'enable-rcon=true' >> server.properties
  fi
  if grep -q '^rcon.port=' server.properties; then
    sed -i 's/^rcon.port=.*/rcon.port=25575/' server.properties
  else
    echo 'rcon.port=25575' >> server.properties
  fi
  if [ -n "${RCON_PASSWORD:-}" ]; then
    if grep -q '^rcon.password=' server.properties; then
      sed -i "s/^rcon.password=.*/rcon.password=${RCON_PASSWORD}/" server.properties
    else
      echo "rcon.password=${RCON_PASSWORD}" >> server.properties
    fi
  fi
  # 离线模式（AI bot 任意用户名可连）
  if grep -q '^online-mode=' server.properties; then
    sed -i 's/^online-mode=.*/online-mode=false/' server.properties
  else
    echo 'online-mode=false' >> server.properties
  fi
fi

# 2) 优雅停机：docker stop -> RCON stop 存盘后退出
cleanup() {
  echo "[mc-entrypoint] SIGTERM: RCON stop MC ..."
  # 简单方案：无 RCON 工具时直接 TERM java（MC 会尽量存盘）
  kill -TERM "$JAVA_PID" 2>/dev/null
  wait "$JAVA_PID" 2>/dev/null
  exit 0
}
trap cleanup TERM INT

# 3) 起 NeoForge 服务端（unix_args.txt 由 NeoForge 安装生成）
exec java ${JAVA_OPTS:--Xms2G -Xmx4G} \
  @user_jvm_args.txt \
  @libraries/net/neoforged/neoforge/21.1.233/unix_args.txt \
  nogui &
JAVA_PID=$!
wait "$JAVA_PID"
