# 原版 Mineflayer 零插件接入复测

后续进展：[服务端兼容入口 39786 已实现并完成首批官方 Mineflayer 联机验收](../stock-gateway/README.md)。本页保留原生端口 39781 的直连检查，不把新入口成功改写为直连成功。

2026-11-01 的要求是使用未修改的官方 Mineflayer，不额外安装客户端插件或连接器，并且取得正确的模组信息。**截至本页原始直连复测时，该要求尚未达到。** 前次成功属于 `create_bot.cjs` 及打过补丁的依赖栈，不作为原版接入成功的证据。

## 实测结果

在独立目录通过 npm 安装 `mineflayer@4.39.0`，关闭依赖安装脚本。没有使用自研 SDK、`loadPlugin`、自定义 client、协议覆盖、注册表注入或核心的依赖补丁。官方 npm 归档 SHA-512 与安装锁一致；188 个发布文件逐字比较，差异 0 个。

| 对照 | 实际结果 | 是否取得真实世界信息 |
| --- | --- | --- |
| 官方 4.39.0，`version: '26.3'` | `unsupported protocol version: 26.3` | 否，未登录 |
| 官方 4.39.0，自动版本 | `No data available for version 26.3` | 否，未登录 |
| 已补协议的实验依赖，但直接调用公开 `createBot`，不加载连接器 | 被服务端以需要 Fabric Loader / Fabric API 拒绝，列出 Better Combat 等注册表命名空间 | 否，未进入世界；这项不是官方包测试 |
| 配套原生连接器 | 前次记录的基础动作、真实锅菜单、本人任务视图通过 | 是，但依赖客户端连接器，不符合本次零插件条件 |

官方包此次解析出的依赖是 `minecraft-data@3.119.0`、`minecraft-protocol@1.68.0`；其 `latestSupportedVersion` 为 `26.1`。上游仍有未合并的 [26.3 PR #4124](https://github.com/PrismarineJS/mineflayer/pull/4124)，[官方仓库讨论 #4190](https://github.com/PrismarineJS/mineflayer/discussions/4190) 也区分了版本支持与 ViaProxy 转换。代理可处理其支持的原版协议，不等于会实现任意模组的注册表、物品组件和菜单 codec。

## 不止是版本号

额外使用已经验收的原生连接器作为**只读服务端目录对照**，比较同一服务器 JVM 的真实注册表与 26.3 原版数据表。这不是原版客户端取得了这些数据，也不是零插件成功证明。

| 实际原生内容 | 服务端 ID | 原版 26.3 表中相同 ID |
| --- | --- | --- |
| `farmersdelight:rice` | 物品 1810 | 未定义 |
| `farmersdelight:cooking_pot` | 物品 1715 | 未定义 |
| `farmersdelight:cooking_pot` | 方块状态 35756 | 未定义 |

该原版表有 1658 种物品，当前服务器有 2048 种。官方 Mineflayer 的 [loader](https://github.com/PrismarineJS/mineflayer/blob/master/lib/loader.js) 按版本创建 Prismarine 注册表；收到额外自定义频道不会自行替换其物品表、方块表和解码器。仅给物品改 `custom_name`、下发资源包、发 JSON 或关闭 Fabric 检查，都不能让标准 `item.name` / `block.name` 自动认识这些原生 ID。

## 现成服务端方案筛选

| 项目 | 官方说明与本次判断 |
| --- | --- |
| [ViaProxy](https://github.com/ViaVersion/ViaProxy/releases) | 3.4.13 加入 26.3 协议支持，可解决原版跨版本的一部分问题；未在当前组合做联机验收，不能由此宣称农夫乐事／法术菜单等可用 |
| [Polymer](https://github.com/Patbox/polymer) | 官方明确它是服务端内容开发库，**不自动把现有模组转成仅服务端模组**；当前商店已经依赖它，也没有因此让整套组合兼容原版 |
| [PolyMc Reborn](https://github.com/fadeway37/PolyMc-Reborn) | 面向不装内容模组的客户端，但当前公开版 0.9.0+26.1.2 明确仅对应 26.1.2；不作为 26.3 可直接安装的解决方案。作者也明确保留未知形状、自定义 GUI、codec 等边界 |

没有把不匹配的 JAR 装入实验服，也没有为制造连接成功关闭注册表校验。

## 零客户端插件的后续契约

下面是当时提出的服务端契约。后续入口已实现首批能力，具体通过项与限制以新入口文档为准，不把尚未验收的设计写成已开放功能。

1. 服务端或独立网关处理原版客户端支持的协议、模组注册同步及自定义 codec；保持认证、身体 UUID、动作回执、距离、碰撞和保护约束。
2. 普通移动、挖掘、放置、物品栏及容器交互仍使用标准 Mineflayer API；任何显示载体都必须明确标为载体。未知碰撞或不能等价表示的方块不能冒称为精确的原版方块。
3. 原生物品身份、操作说明、真实菜单和配方通过普通客户端能读取的标准组件及私有查询回执提供。私有查询可使用标准命令／系统消息，Agent 自己决定如何读取，不要求加载 Mineflayer 插件；周期数据不得刷屏。
4. 必须区分标准 API 的载体类型与真实模组身份。若要求未修改的 `bot.blockAt(...).name` 本身直接返回原版表外的模组 ID，则只改服务端无法满足；不能隐藏注入代码或替换 npm 包后仍称原版客户端。
5. 新入口必须另行用干净 npm 目录验收登录、真实物品、区块、交互、菜单、重连与错误处理，核对实际服务端结果。登录成功不代表所有模组语义已经准确。

原始直连检查这一轮未修改模组组合、服务器 JAR、世界、端口、认证或防火墙。后续入口的独立发布记录另见新目录。

## 复测

在一个新 Node 22+ 项目中安装官方包，保留生成的 `package-lock.json`：

```powershell
npm install --prefix <全新目录> --ignore-scripts --no-audit --no-fund --save-exact mineflayer@4.39.0
node stock_probe.cjs <全新目录> 26.3
node stock_probe.cjs <全新目录> auto
```

探针只访问本机 `127.0.0.1:39781`，最多 30 秒，不发送游戏命令、移动、挖掘、容器或消耗动作。输出包含依赖版本、源文件摘要、登录／出生／区块状态与原始错误；退出码 2 表示未接入，3 表示取得部分基础读取但原生语义尚未验证。不能把 `partial` 当作整合包兼容通过。原始私人日志与安装目录保留，公开摘要见 `stock-acceptance-20261101.json`。
