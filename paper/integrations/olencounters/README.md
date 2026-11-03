# OlEncounters / Youer 异步区块兼容

状态：`1.7.0-qd-youer1` 已隔离验证，尚未安装正式服。当前正式插件仍为1.7.0；维护与验证边界见[健康修复记录](../../docs/HEALTH_REPAIRS_20261103.md)。

固定原JAR SHA256：`1577935cc738f199719db7c1b4eaa1630a4ecaa208aba5f5d18943585075ab0f`。构建器用ASM只替换 `LocationFinder.lambda$snapshotAsync$22` 内唯一 `World.getChunkAtAsync(int,int,boolean)`，并增加本目录辅助类；调用点不匹配即停止，原依赖和188个其他条目保持原字节。

Youer固定源码的 [CraftWorld](https://github.com/MohistMC/Youer/blob/23f932ae111931962e2164ef1041b01d539900f9/src/main/java/org/bukkit/craftbukkit/CraftWorld.java) 中该API只查已加载区块；原生 [ServerChunkCache补丁](https://github.com/MohistMC/Youer/blob/23f932ae111931962e2164ef1041b01d539900f9/patches/net/minecraft/server/level/ServerChunkCache.java.patch) 与实际编译API用于核对真实 FULL future。已有上游问题 [#596](https://github.com/MohistMC/Youer/issues/596) 保留，不另建重复报告。

兼容层保留选址生成政策、异步生命周期、世界实例和搜索终态；禁止生成先查磁盘区块是否存在。排队开始和回调均复查搜索，超时100 tick，不取消共享原生future；主线程仅在实际已加载后读取快照，无同步生成兜底。原生请求使用其临时加载票据，未添加Bukkit永久forceload。非Youer继续用原Bukkit调用。本补丁绑定现役Youer1.21.1原生API，换内核须重新编译和联机验证。

Windows构建示例（输出必须是新的目录，不能写入服务端）：

```powershell
python build-youer-chunks.py --server E:/MC/server --jdk E:/MC/jdk/jdk-21.0.12.1+1 --output E:/MC/staging/new-ol-build
```

`build.json`列出源/候选摘要及实际条目差异。候选验证包括：真实冷区块返回空的对照、禁止生成、允许生成、已结束搜索拒绝、原LocationFinder实际选址，以及正常停服重启后的冷磁盘区块读取。测试夹具在AgentFriend测试目录，只准独立回环端口，不能部署正式服。通过这些检查不等于所有自然陨石事件已在正式服长期验收。
