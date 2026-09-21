# 皮肤与形象：走 YSM，不走皮肤代理

> 2026-09-21 定调（造物主）：**皮肤代理不再管了** ✓ 服务端已装 **YSM（Yes! Steve Model）2.6.5** ✓
> 模型内置在服务端、玩家自己选、Agent 随机分配初始形象 ✓ 这条路线让 `skin-proxy` 失去存在理由 ✓

## 现状（实测）

| 项 | 值 |
|---|---|
| 模组 | `server/mc/mods/ysm-2.6.5-neoforge+mc1.21.1.jar`（63.5MB） |
| 服务端模型目录 | `server/mc/config/yes_steve_model/{builtin,custom}/` |
| 可用模型 | **29 套**（`default` + `misc/*` 4 套 + `wine_fox/*` 22 套 + 自制 `qiandengji_kirito`、`qiandengji_naruto`） |
| 玩家自选 | 游戏内 **Alt+Y** 打开模型界面（`CanSwitchModel=true` ✓） |
| 授权状态 | 之前 `auth/` 为空 → **没人被授权，所以谁都选不了** ✓ 现已开始授权 |

## 命令（全部 OP 2 级；RCON 可用）

```
/ysm auth  <玩家> all                    授权全部模型（之后玩家可自选）
/ysm auth  <玩家> add <模型id>           授权单个模型
/ysm auth  <玩家> remove <模型id>        取消授权
/ysm auth  <玩家> clear                  清空授权
/ysm model set <玩家> <模型> <材质> true  服务端直接定模型（末位 true = 无视授权）
/ysm model reload                        往 custom/ 放新模型后重载并同步全服
```

**两条踩过的坑（务必照做）**：
1. 模型 id：内置包 **要带包名**（`wine_fox/22_elf`、`misc/1_alex`）✓ 自制包 **只用文件夹名**（`qiandengji_kirito`）✓ 默认模型是 `default`
2. **含斜杠的 id 必须加双引号** ✓ 否则 brigadier 报 `Expected whitespace to end one argument, but found trailing data`
3. 授权**不落盘**（`auth/` 目录不写文件）→ 只能走命令，不能手写配置文件

## 工具（已入仓）

`world/tools/ysm_assign.py`：

```
python world/tools/ysm_assign.py list                  # 打印模型池
python world/tools/ysm_assign.py grant  <玩家...>       # 授权全库 → 真人自己选
python world/tools/ysm_assign.py random <玩家...>       # 授权 + 随机定模型 → Agent 初始形象
python world/tools/ysm_assign.py set    <玩家> <模型id> # 指定
```
RCON 口令来源：`--secret <文件>` > `MC_RCON_SECRET` > `server/world-data/rcon-secret.txt` ✓ 宿主默认 `127.0.0.1:25577` ✓

## 分工约定

- **真人玩家**：`grant`（授权全库）→ 让**他们自己**在 Alt+Y 里挑 ✓ 服务端不替玩家决定长相 ✓
- **Agent / 假玩家**：`random` ✓ 随机分配初始形象 ✓ 之后想固定就用 `set`
- **加新模型**：把基岩版格式的 模型/材质/动画 放进 `server/mc/config/yes_steve_model/custom/<新文件夹>/` ✓ 然后 `/ysm model reload` ✓（YSM 也支持游戏内下载界面与在线模型源 ✓ 本仓不代下载，注意版权）
- 不想要的内置模型可在 `blacklist.txt` 关掉（省加载）

## 与皮肤代理的关系（重要）

- `skin-proxy-local.mjs`（宿主 :25566）走的是 **GameProfile textures 注入官方皮肤** ✓ 与 YSM 是**两条不同的路** ✓
- YSM 落地后 ✓ 皮肤代理**不再需要** ✓ 容器化尝试已回滚（它有个"首会话后上游半死"的进程内缺陷未修 ✓ 见 `world/host-services/skin-proxy/notes.md`）✓ **建议：观察一段后连宿主实例一起退役** ✓ 这样宿主进程只剩基岩桥一个
- 边界要说清：YSM 的模型**需要客户端装 YSM 才看得见** ✓ 所以——真人 Java 客户端（装了这个整合包）✓ 看得到 ✓；**基岩版访客 ✗ 看不到**；**天神之眼网页端 ✗ 也看不到**（它只认原版皮肤）✓ 这不是缺陷 ✓ 是模组的固有边界 ✓

## 待办

1. 给**所有会进服的真人**执行 `grant`（现在只授权了在线的 corti）✓ 最好接到"玩家首次进服自动授权"里 ✓
2. 给 numen 身体的 summon 流程接上 `random`（现在要手动跑一次）✓ 落点建议：`world/sidecar/guard/mcp_numen.py` 的 `summon` 成功后调用 ✓ 或宿主侧循环里补 ✓
3. 扩充模型池（版权与来源要挑 ✓ 别把别人的付费模型直接塞进包里）
