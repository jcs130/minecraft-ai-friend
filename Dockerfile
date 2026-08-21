# minecraft-ai-friend 世界进程 + 观察面板镜像（2026-08-21 脱壳后）
#
# build context = 本仓库根目录（minecraft-ai-friend）
#   docker build -t mc-world .
#
# 脱壳说明：世界进程已改为手动依赖注入（createXxx 工厂 + bootstrap-world.mts 装配），
# 彻底不依赖 @deepseek-ai/* / cordis。本镜像只装 npm 依赖 + tsx 运行。
# 观察面板（web-panel.mjs）复用同一镜像，compose 里换 command 起第二个服务。
FROM node:22-bookworm-slim

# better-sqlite3 若无 linux prebuilt 则本地编译（python3/make/g++ 兜底）
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖层（package*.json 不变则命中缓存）
COPY package.json package-lock.json ./
RUN npm install --omit=optional --legacy-peer-deps --no-audit --no-fund \
    --registry=https://registry.npmmirror.com \
  && npm install --no-save --legacy-peer-deps --no-audit --no-fund tsx \
    --registry=https://registry.npmmirror.com

# 源码
COPY src ./src
COPY bootstrap-world.mts tsconfig.json web-panel.mjs ./

# 默认配置种子（运行时 data/ 由 volume 挂载；首启 cp -n 播种，不覆盖已有）
COPY data ./defaults

EXPOSE 9090

# 世界进程入口：播种 data + 注入 RCON 密码 + 起女神进程
ENTRYPOINT ["/bin/sh", "-c", "mkdir -p data && cp -rn /app/defaults/. /app/data/ 2>/dev/null; if [ -n \"$RCON_PASSWORD\" ]; then printf '%s' \"$RCON_PASSWORD\" > data/rcon-secret.txt; fi && exec npx tsx bootstrap-world.mts"]
