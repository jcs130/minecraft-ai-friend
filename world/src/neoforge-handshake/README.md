# 神社之门 · 号翻译层（容器内速查卡）

> 本文件随 `world/src` **只读挂载**进 `qiandengji-gate-1` 与 `qiandengji-gate-public-1` 的
> `/app/src/neoforge-handshake/README.md` ✓ 所以在容器里 `cat` 得到它。
> **权威全文在仓库**：`docs/BOTGATE-IDMAP.md`（号映射单一事实源）· 部署动作：`docs/deploy-release-runbook.md` §5

## 这个目录里有什么

| 文件 | 作用 |
|---|---|
| `gate.cjs` | 门本体：前端说原版协议（`0.0.0.0:25700`），后端以 vanilla brand 连 `mc:25599`，CONFIG 期自答模组通道 |
| `idmap.json` | **号表本体**（NeoForge→原版 blockstate/item）✓ 由 `build-idmap.cjs` 生成 ✓ 入 git |
| `idmap-remap.cjs` | 翻译层：出站翻回原版、入站翻回 NeoForge（覆盖 `map_chunk` / `block_change` / `multi_block_change` / ItemStack 四类） |
| `build-idmap.cjs` | 生成器：读 `idmap-dump/*.tsv` + minecraft-data 原版表 → 产号表（含模组物品"最接近原版"三级兜底 + `badRules` fail-fast） |
| `idmap-dump/{blocks,items}.tsv` | 服务端 `/botgate dumpids` 的原始导出（**有名字才谈得上语义映射**） |
| `verify-gate.cjs` | 冒烟 11 项（含 4 项**状态保真**）✓ 改过翻译层/号表后必须跑 |
| `audit-idmap.cjs` | 体检 3 项（覆盖率对账 / 双向往返恒等 / chunk 段模式分布） |
| `knowledge-cache.json` | 通道协商知识缓存 |
| `idmap.json.bak-*` | 本地回滚备份（**已 gitignore**，勿入库） |

## 在容器里怎么判断"门活着且在翻译"

```sh
# 1) 号表是否载入（看启动日志）
#    期望：[REMAP] 载入 state=116650 item=5158 / [REMAP] 反表 state=26684 item=1333
# 2) 谁进门了（链路证据，别拿"画面看着对"当证据）
#    宿主执行： docker logs qiandengji-gate-1 2>&1 | grep 叩门
# 3) 号表新鲜度
#    idmap.json 里的 generatedAt 与 report 计数
```

## 改这里的东西怎么生效（便宜路径）

```
改宿主文件 → docker restart qiandengji-gate-1 qiandengji-gate-public-1
```
`/app/src` 是宿主 `world/src` 的**只读 bind-mount** ✓ 所以**不重建镜像、不重启世界、不掉玩家** ✓
（改号表本身：`node build-idmap.cjs` 后同样只需重启两道门 ✓ 但**必须先在 RCON 跑 `/botgate dumpids` 刷新 tsv**，见仓内文档 §5）

## 三条最容易犯的错（都踩过）

1. **画面正确 ≠ 过了门** ✓ 号错位是"低段侥幸对、高段全错" ✓ 判过门只看门日志名单 / 进程实参
2. **改了文件 ≠ 改了运行态** ✓ 门是常驻进程 ✓ 必须 `docker restart`；宿主侧服务同理（`schtasks /end` **不杀 bat spawn 的孤儿 java**）
3. **只比方块名测不出状态被压平** ✓ 楼梯朝向 / 半砖上下 / 床两头 都藏在 state 里 ✓ 用 `verify-gate.cjs` 的状态保真 4 项
