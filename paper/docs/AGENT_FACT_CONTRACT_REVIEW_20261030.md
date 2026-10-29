# 通用事实契约评估：只读，不代表新功能已上线

本轮不为客户端框架复制服务器玩法规则，也不新建模型循环。正式状态、已实现接口与建议扩展分别记录。

| 事实 | 已有来源 | 当前界限与建议 |
| --- | --- | --- |
| 实际世界 | Vortex `PlayerLocationView`、status/队伍查询、`mcviewer:state.viewerSession` | 已有世界key与Bukkit UUID，同UUID才比较距离；不能按overworld环境归并aincrad。挑战runId另属活动实例，不等于世界UUID |
| 不可见实体 | AgentVision真实追踪/遮挡过滤、客户端最后可见包 | 当前没有完整公开的原因流。移除包只证明不再向客户端展示，不证明实体死亡；last_seen只保存最后实际可见观测，不追加遮挡后实时坐标。遮挡/超距/世界切换/销毁原因缺证据时保持unknown |
| 职业和技能 | 正在加载的Vortex定义、职业catalogVersion、单项info、实时mana/CD | 职业目录已有内容版本；完整技能目录/已学/当前可用/实时费用和冷却仍应分别缓存。候选调用索引revision只覆盖调用路由，不能充当所有技能数据的版本 |
| 动作回执 | MC核心队列、CLI真实结果、Vortex持久操作、语音requestId | 尚无所有普通聊天CLI动作统一的原requestId/最终效果协议；观察sequence不等于动作ID。受理、持久成功、实际伤害/位移与未知效果分开。语音sent也不证明人耳听见 |
| 聊天 | 正式EssentialsChat、原版私聊、接收者客户端真实incoming | 当前同世界48格、显式全服喊话、原版私聊；@不扩大范围。候选agent-mc/chat-policy/v1未上线，现役客户端不能提前依赖。client sent与packet incoming均不等于recipientRead |

通用解析、缓存、last_seen与动作阶段应回到MC核心；千灯纪只提供当前配置和实际事件的适配。服务端未提供的事实不能由客户端补成肯定结论。不能为本评估放宽遮挡、给隐藏实体坐标、改玩家职业、代执行技能或重启服务器。

原生Java观战仍有界面边界：服务器 `mcviewer:state` 有目标身份、vitals、mana、rpg、abilities等；客户端须核对recipient和target，换目标清旧状态。现役原生侧栏尚不能按完整目标界面验收，安装SpectatorPlus不等于自动消费全部RPG数据。

语音为SVC2.6.27/独立UDP24454，force_voice_chat=false。观战两个spectator开关描述的是发话权限，不能据其false断言听音被关闭；真人耳听和真实附身听音仍需客户端验证。原生核显相机候选不是已发布的完整Java整合客户端；live原密码保持，没有找到可供交接的明文登录材料。
