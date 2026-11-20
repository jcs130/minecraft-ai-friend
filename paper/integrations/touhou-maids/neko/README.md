# N.E.K.O. 酒狐插件 · 千灯纪

服主启用本人女仆授权后，玩家可用千灯纪账号配对，官网会列出其已登记的女仆。[官网授权说明](WEBSITE.md)

要在桌面角色里选择车万女仆或 Numen 身体，或从 Cortico 和自定义 Agent 接入，请使用通用居民插件。[桌面居民接入指南](../../../../packages/agent-harness-py/integrations/README.md)

在私人 N.E.K.O. 角色对话中读写已登记的车万女仆。**玩家电脑按 [HTTPS 接入说明](API.md) 安装和配置。** 插件用 Python `MaidBody` 绑定原 `maidId`、`ownerId`，经 API 到现有 Youer 本机身体端口调用 `mc_maids`。服务端用原实体、权限、租约代次和动作账本执行。N.E.K.O. 负责对话、工具选择与自己的会话。

此处的工具名、声明结构、对话注入、单条聊天事件分发和启动时工具注册采用酒狐插件 `v1.0.7_1` 的实现方式，按千灯纪的执行契约调整。市场和源码仍使用 `neko_tlm`。Python 源码固定于 `4f09275a08c08d7d53af3d7df84447eb77a317a6`。[酒狐插件源码](https://github.com/ggg233m/n.e.k.o_plugin_neko_tlm/tree/v1.0.7_1)

保留 [上游 MIT 许可](neko_tlm/LICENSE) 和 ggg233m 版权。上游 MIT 主仓库 `v1.0.7` 包含相同的工具、指令和事件源码。千灯纪版从现有原生身体端口执行动作。[上游 MIT 主仓库](https://github.com/ggg233m/N.E.K.OxTLM/tree/v1.0.7)

## 本机调试

1. 在 Youer 上使用支持 `qiandengji-maid-body/v1` 的现有女仆桥。按[原私人身体端口](../../../docs/MAID_NATIVE_BODY_PORT_20261117.md)登记现有私有女仆和原主人 UUID。`.42` 及以上提供有限私人伙伴法术。本机鉴权文件使用该绑定所在端口对应的私有令牌。两侧进程需要访问同一 `127.0.0.1`。
2. 使用具备 `register_llm_tool` 的 N.E.K.O. 源码运行环境。在 `minecraft-ai-friend` 根目录运行下列命令，将适配器装入要打包或加载的 `neko_tlm/vendor/`。将路径替换为实际插件目录。需要已安装 `uv`。

   ```powershell
   uv pip install --no-deps --target '<N.E.K.O.>/plugin/plugins/neko_tlm/vendor' './packages/agent-harness-py'
   ```

3. 在 N.E.K.O. 插件管理器导入千灯纪版 `.neko-plugin`，或在源码开发环境中将整个 `neko_tlm/` 放入 `plugin/plugins/`。同 ID 原版需先停止并由该包替换。为此身体选择专用私人 N.E.K.O. 角色。运行 N.E.K.O. 的服务及会话入口应限制在有权操作此身体的主人环境。
4. 复制 `body.example.json` 到私有目录，填写原绑定、令牌绝对路径和实际 N.E.K.O. 角色名。在启动 N.E.K.O. 的进程环境设置 `QIANDENGJI_NEKO_MAID_CONFIG` 为该文件的绝对路径。`forward_owner_dialogue` 控制是否把新收到的主人游戏留言送入该角色的对话。默认关闭，示例已开启。
5. 启动指定角色的支持工具调用的 N.E.K.O. 对话。手动启动千灯纪版酒狐插件。插件入口 `body_connection` 可查询连接状态。用 `mc_maid_status` 核对原 UUID、位置和已注册工具，然后尝试走到测试坐标，用原 `request_id` 查询结果。角色选择仅作用于 N.E.K.O. 会话。

## 行动与对话

- **走到坐标** `navigate_maid_to_coordinates` 使用同维度的已加载目标，最多 96 格，服务端导航期限 30 秒。`running` 或 `accepted` 表示寻路已开始。`mc_maid_action_result` 按原 ID 查询，`completed`、`goalCompleted` 和 `actualPosition` 共同证明到达。网络回执不明时查询同一 ID。
- **跟随与停止** `mc_switch_follow` 切换随行或驻守，`mc_stop_maid_activity` 停止寻路和随行并坐下。随行回执是模式确认。主人离线时缺少跟随目标。可以检查体位和实际坐标。
- **状态、物品与法术** 可读取身体、背包、原工作模式、法术和法力。只有服务端宣告对应能力才注册工具。装备取自本人背包，施法是原私人伙伴法术，按原执行器回执报告。采矿、挖路、任意命令、物资转移和通用建造目前缺少本插件执行入口。
- **游戏文字** 主人通过 `/qdmaid talk <maidId> <requestId> <消息>` 留言。独占期间，服务器收到的指定女仆对话也可进入原收件箱。转交 N.E.K.O. 时保留 `eventId`、真实说话者 UUID 和名称、时间、`sessionKey`、`memoryNamespace`。访客留言仍在游戏收件箱，只有原主人 UUID 的新消息能发起 N.E.K.O. 动作回合。插件重启时已有留言可用 `mc_maid_inbox` 查询。
- **游戏内答复** `mc_send_chat` 复用女仆原有文字、气泡和声音入口。携带原 `event_id` 时，仅能答复该主人的待处理留言，按稳定请求号提交，在 `speak` 确认应用后才提交 `ack`。游戏文字面向附近可见玩家，回执包含实际文字接收人数。声音是否听到要在游戏现场另验。

## 控制权交接和回退

1. 在 N.E.K.O. 中用停止工具并记录在途动作的原请求 ID，然后停止此插件，让它释放租约。插件绑定期间，服务端暂停原身体控制与原对话模型，原人设、模型选择、声线及原会话记忆由原服务保存。插件没有原 TLM 对话历史迁移入口。
2. 主人可以用原菜单收回控制。服务端拒绝另一个控制器并发绑定，拒绝访客取得身体。收到 `CONTROL_CHANGED` 后插件撤下工具，显式重启插件才发起新绑定。进程意外退出后由服务端租约超时清理，租约上限 120 秒。
3. 回到原伙伴模式时停用千灯纪版酒狐插件，恢复原伙伴菜单的工作或随行选择。复用原实体、原配置、当前物品和动作账本。若仅为 N.E.K.O. 开启本机端口，可按服务端维护流程移除该绑定。若 N.E.K.O. 还用于原版酒狐，先恢复其独立的原版插件包。

正式环境的版本选择、发布和角色切换由服务端维护会话执行。隔离联测使用专用角色。
