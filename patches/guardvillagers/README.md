# Guard Villagers 2.4.12 装备读取修复

本目录只保存可审查的源码补丁及说明，不包含 JAR、第三方资源或世界存档。**候选未安装生产或客户端，也没有提交到上游。** 2026-09-20 已在无网络的独立服务器副本完成本文限定的验证；这不是整套 Guard 接入验收，也不是 LLM/RSI 自我进化成果。

## 固定来源与产物

| 项目 | 固定值 |
| --- | --- |
| 上游 | [seymourimadeit/guardvillagers](https://github.com/seymourimadeit/guardvillagers) |
| 源码 commit | `07f5c024f6e6a5faa9759f82b196509a4c180ac7`（`gradle.properties` 为 2.4.12） |
| 官方发行 | [Modrinth JyXugpy2](https://modrinth.com/mod/guard-villagers/version/JyXugpy2) / [CurseForge 8767509](https://www.curseforge.com/minecraft/mc-mods/guard-villagers/files/8767509)，`guardvillagers-2.4.12-1.21.1.jar` |
| 官方 JAR SHA256 | `aab03d59216bd931a05434b2527e0d5b7641793bd0178a9958100579c4f11407` |
| 本补丁 SHA256 | `23f4e684f1eec0e116f14153581cd8c1da7349e952a50a765dd9f13674cb5cd6` |
| 本地候选版本 | `2.4.12-qiandeng-inventory1`，不是上游正式发行 |
| 候选 JAR | `guardvillagers-2.4.12-qiandeng-inventory1-1.21.1.jar`，283,379 字节 |
| 已测候选 SHA256 | `d644d9d77b5285a8ddbe80772dd84aeda0bb154dfb97957608474fefe4cc49ff` |

哈希标识此次实际构建、实际加载的文件；未声明不同机器/时间的重建 JAR 一定逐字节相同。只修改 `src/main/java/tallestegg/guardvillagers/common/entities/Guard.java` 的 `readAdditionalSaveData` 装备读取区块，不改战斗、伤害、巡逻参数或生成规则。

## 已复现问题与修复范围

官方 2.4.12 中，一个新建弩卫自主射杀测试僵尸后，自有 `Inventory` 中的弩损耗为 `minecraft:damage=6`，原版 `HandItems` 却仍无 damage。正常 `save-all flush`、`stop`、重启后，同一 UUID、同一弩损耗变回默认 0。

[上游 Guard.java](https://github.com/seymourimadeit/guardvillagers/blob/07f5c024f6e6a5faa9759f82b196509a4c180ac7/src/main/java/tallestegg/guardvillagers/common/entities/Guard.java#L247) 用元素类型 9 读取 `Inventory`，而保存的是类型 10 的 Compound 列表。仅改成 10 仍不够：原循环遇到空槽会继续向被遍历列表追加空 Compound，且后续会用陈旧的 `ArmorItems`/`HandItems` 覆盖自有装备。

补丁将存在的 `Inventory` 作为权威状态，先清理六槽，再按 Compound 和有效 Slot 0–5 读取；跳过无 Slot/越界项，不在遍历中修改输入列表。空列表和空槽保持为空，不从陈旧装备字段复活物品。只有缺少 `Inventory` 的旧存档/原版召唤数据才回退读取标准 `ArmorItems`（脚→头）和 `HandItems`（主手→副手），保留服务器侧怒气状态读取。

这是对已验证数据损失的局部修复；不负责修复其他模组写入非法 NBT，也不宣称覆盖所有历史 Guard 版本。

## 构建方法

实际构建使用 Windows、Eclipse Adoptium Java `21.0.11+10`、上游 wrapper Gradle 8.9、NeoGradle userdev 7.0.165、原声明 NeoForge 21.1.215。没有改动或删除上游构建依赖（包括原 CurseMaven 依赖）；只通过命令行覆盖 `mod_version` 标记本地版本。

在项目根目录的 PowerShell 中，使用一个新的独立源码目录：

```powershell
$guardPatch = (Resolve-Path 'patches/guardvillagers/inventory-load.patch').Path
git clone https://github.com/seymourimadeit/guardvillagers runtime/guard-source
if ($LASTEXITCODE -ne 0) { throw 'clone failed' }
Push-Location runtime/guard-source
try {
    git checkout --detach 07f5c024f6e6a5faa9759f82b196509a4c180ac7
    if ($LASTEXITCODE -ne 0) { throw 'checkout failed' }
    git apply --check $guardPatch
    if ($LASTEXITCODE -ne 0) { throw 'patch check failed' }
    git apply $guardPatch
    if ($LASTEXITCODE -ne 0) { throw 'patch apply failed' }
    $env:JAVA_HOME = 'C:/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot'
    .\gradlew.bat --no-daemon build '-Pmod_version=2.4.12-qiandeng-inventory1'
    if ($LASTEXITCODE -ne 0) { throw 'build failed' }
} finally {
    Pop-Location
}
```

将示例 Java 路径替换为实际 Java 21 安装目录。产物位于 `build/libs/`。实际完整构建 `BUILD SUCCESSFUL`，耗时 11 分 16 秒、33 个任务；`test` 和 `testJunit` 均为 `NO-SOURCE`，所以构建成功不能当成自动功能测试通过。首次尝试离线构建因缺少官方插件失败，随后按原构建配置联网获取官方依赖并完成，未绕过依赖检查。

## 22 项隔离检查

实际运行：Minecraft 1.21.1 / NeoForge 21.1.248 / Java 21，原 72 模组加此 Guard 候选共 73 个 JAR。固定镜像 `sha256:f71707d922f9d616c654ff504bf41e4d09dbf4fa1cd9776ccca660bb2accbab8`，4 GB 容器内存、2 CPU、Java 上限 3 GB。世界和配置独立复制；生产 libraries 只读挂载，容器 `network_mode=none`、不发布端口，模型凭据/推理与生产桥连接关闭。未连接任何第三方模型。

测试只作用于 (10000,200,10000) 附近新建、标记 `guardqa` 的实体。管理员 NBT/装备命令是测试夹具，不能冒充桐人自主操作。实际弩卫击杀日志明确 `Fix Roundtrip Target was shot by QA Crossbow`。

| 检查组 | 断言数 | 实际结果 |
| --- | ---: | --- |
| 五个卫兵 UUID 和装备在正常保存重启前后相同 | 10 | 全部保留 |
| 原弩卫实际产生损耗、重启后精确相同 | 2 | **6 → 6**（官方原包同情景为 6 → 0） |
| 旧格式主手/副手/盔甲损耗，重启前后分别检查 | 2 | 弩 11、盾 7、铁靴 17 |
| 旧格式附魔，重启前后分别检查 | 2 | 耐久 II 保留 |
| 自有 Inventory 优先、组件及越界槽，重启前后分别检查 | 2 | 弩损耗 37、耐久 II 保留；旧剑不覆盖；Slot 256 不进入装备 |
| 空 Inventory，重启前后分别检查 | 2 | 不复活陈旧 HandItems 中的钻石剑 |
| 原弩卫巡逻开关及岗点，重启前后分别检查 | 2 | `Patrolling=true`，`(10008,200,10012)` |
| 合计 | **22** | **22/22** |

同一弩卫 UUID 为 `18d2d1eb-711b-4c20-81e1-8f4eab0d4845`；2026-09-20 17:38:21（UTC+8）保存前读取 damage 6，17:42:10 重启后仍为 6。回归后再次正常保存停止，隔离容器 `exited / 0`，未修改生产或客户端。

本机忽略目录 `runtime/town-renewal-20260920/guard-inventory-fix/` 保留构建来源 `provenance.json`、候选 JAR、原许可证、四条夹具命令及 `before.json`/`after.json`/`roundtrip-result.json`。前后证据 SHA256 分别为 `67b6b22f27b824db8c2489b4e0581b68d09bd817dc6992e0a6aa5f9f50122dc2`、`1835943b7520c9f27081d1648148e8fd618f24fc7942ba7e29267e64a6109a16`。`guard-qa-3930638eb9/commands.jsonl` 为追加式完整命令回执，原官方包验证摘要中的哈希对应其前 70 行原始字节；后续修复测试追加，未改写原记录。

## 尚未完成的接入边界

- 未安装生产或真人客户端；客户端加入、装备 GUI、声望/英雄效果门槛、假玩家自定义菜单及岗点网络包没有实测。
- 没有验证网页观察器的 Guard 注册表、模型/纹理和持续 WebGL 渲染；不能为兼容放宽其来源、内存或鉴权限制。
- 没有完成牧师治疗、铁匠维修、复杂路网/水岸长期寻路、普通生存战斗平衡和公会交易归属验证。测试卫兵无敌，不能据此判断真实存活率或盾牌减伤。
- 六个绑定 NPC 硬依赖原版 villager 类型/UUID；本方案只考虑独立新卫兵，不转换现有 33 位居民。模组 Java 行为树/目标不会自动变成 LLM 决策或 RSI。

## 上游许可

[固定 commit 的 LICENSE](https://github.com/seymourimadeit/guardvillagers/blob/07f5c024f6e6a5faa9759f82b196509a4c180ac7/LICENSE) 明确：`src/main/resources/` 及其子目录资源为 All Rights Reserved；资源可在保留署名且仍处于模组内的条件下用于整合包。本目录不复制这些资源，不把资源当作 MIT 发布。

本补丁所改 Java 源码属于许可证中“Any other files”，按 MIT 授权。保留上游版权及许可如下：

```text
MIT License

Copyright (c) 2023-2026 seymourimadeit

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
