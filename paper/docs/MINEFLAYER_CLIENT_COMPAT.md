# Mineflayer 1.20.6 接入兼容补丁

核验日期：2026-10-11。适用于本服务器的第三方 Mineflayer 机器人；不需要修改服务器，也不会自动安装到远端机器人。接入方应把补丁接到自己的启动入口。

## 上游版本与复现

已核对官方发布记录和 npm registry，当前发布版本为 [Mineflayer 4.39.0](https://github.com/PrismarineJS/mineflayer/releases)、[minecraft-protocol 1.68.0](https://github.com/PrismarineJS/node-minecraft-protocol/releases)、[minecraft-data 3.117.0](https://github.com/PrismarineJS/minecraft-data/releases)。在独立依赖目录安装这三个精确版本后，连接实际 Paper 1.20.6 隔离服，101156 字节的 `declare_recipes` 包仍触发 `array size is abnormally large`，未进入正常世界加载。因此本次没有可替代补丁的已验证上游升级。

模块：`paper/ops/mineflayer-client-compat.mjs`，没有新增运行依赖。配方部分只修改指定连接的解析器，在 ProtoDef 解析前丢弃 **play 阶段、1.20.6、0x77 declare_recipes** 的完整包帧；不吞其他包的错误，不改全局协议数据，不放宽数组大小限制。仅删除包事件监听器或在 `bot.error` 后捕获异常，时机都太晚。

关闭配方同步后，本地静态配方仍可使用，但机器人无法获得服务端自定义配方列表。此方案适用于不依赖这份同步数据的机器人；其他 Minecraft 版本不启用绕过。

## 接入示例

把模块复制到机器人项目中，再按实际相对路径导入：

```js
import mineflayer from 'mineflayer';
import {
  installRecipePacketBypass,
  installServerWhispers
} from './mineflayer-client-compat.mjs';

const bot = mineflayer.createBot({
  host: process.env.MC_HOST ?? '127.0.0.1',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USERNAME ?? 'ag_Test',
  auth: 'offline',
  version: '1.20.6'
});

// 必须紧接 createBot 同步安装，不能等 spawn/login 后才安装。
const recipes = installRecipePacketBypass(bot._client, {
  enabled: process.env.MC_SKIP_SERVER_RECIPES !== '0'
});

// loadPlugin 确保 Mineflayer 内置聊天插件已经初始化。
bot.loadPlugin(b => installServerWhispers(b, async ({sender, message, reply}) => {
  // 在这里调用原有问答逻辑。把旧 bot.on('whisper', ...) 逻辑迁来。
  console.log('私聊来自', sender, message);
  reply('收到～'); // 始终为 /msg <真实用户名> <内容>
}));
bot.on('serverWhisperError', error => console.error('私聊未发送：', error));
bot.on('spawn', () => console.log('已加载世界，跳过配方包数：', recipes.skippedPackets));
```

`recipes.setEnabled(false)` 可运行中停用，`setEnabled(true)` 可恢复；`dispose()` 恢复原解析器并移除监听器。连接结束时自动清理，每次重连创建的新 bot 都应安装一次。环境变量 `MC_SKIP_SERVER_RECIPES=0` 可用于上游修复后的对照验证。

私聊解析监听原始 `messagestr`，移除内置 whisper 匹配规则，保留公屏规则。支持可选称号、一个或多个方括号标签、颜色码及普通私聊，用户名取 `whispers to you:` 前的真实登录名；公屏、发出的私聊和无效用户名不匹配。原消息组件明确为公屏时也拒绝解析。不要继续用旧 `whisper` 事件路由私聊或把失败回复回退到公屏。

`reply()` 拒绝非法收件人、换行/控制字符、空内容和超过 Minecraft 256 字符限制的命令。模型答复过长时由接入方缩短，失败只报 `serverWhisperError`，不公开发送。

## 验证

从仓库根目录执行（测试需要已安装的 Mineflayer 及其依赖，按该 Mineflayer 实际使用的协议库解析）：

```powershell
npm --prefix paper/probe install --ignore-scripts --no-audit --no-fund
node --test paper/probe/mineflayer-client-compat.test.mjs
```

默认使用 `paper/probe/package.json` 对应的依赖，首次需安装；不会借用正式机器人进程的依赖。要检查第三方机器人已经安装的实际依赖，可跳过上述安装，指定其 package.json 绝对路径：

```powershell
$env:MINEFLAYER_TEST_PACKAGE = 'C:/your-bot/package.json'
node --test paper/probe/mineflayer-client-compat.test.mjs
Remove-Item Env:MINEFLAYER_TEST_PACKAGE
```

13 项回归包含真实协议解析器的坏配方包丢弃、后续 keepalive/实体包、停用/恢复/清理、重配置、连接隔离和非配方错误，以及称号加标签/仅标签/无前缀/公屏四种必要格式、颜色标签、只发 `/msg` 与异步失败不发公屏。

最新三依赖还通过了隔离服三客户端的 7 项实际连接验证：真实服务器配方包被跳过，区块/实体正常加载，原生命令私聊和三种带前缀文本正确路由，旁观客户端看不到公开回复，原 CLI 可用且没有解析错误。测试回执在私有运维目录 `E:/MC/research/mineflayer-client-fixes-20261011`；正式玩家物品及远端客户端未修改。

接入方最终检查：日志中 `skippedPackets >= 1`、有 `spawn` 和世界方块/实体；给机器人发送私聊，机器人应仅回复发送者，其他在线玩家看不到该回复。此处服务器侧验证不等于第三方实际运行入口已更新。
