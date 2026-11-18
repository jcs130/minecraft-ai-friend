export const STATE_TOOL = {
  name: 'mc_qiandengji', tags: ['read'], description: 'Read this connection\'s private Qiandengji mana/skills and latest skill/protection receipts, or the server guide. Each payload retains its observedAt; absent/old values are unknown. Does not send a command, cast a spell or modify the body.',
  parameters: { type: 'object', properties: { action: { enum: ['state', 'guide'] } }, additionalProperties: false },
};
export const GUIDE = `千灯纪：先确认本连接已通过服务器认证并进入世界，大厅出生不算入服。
先用 /mycli status 看本人下一步，/mycli --help 按需学一个命令；tasks list 可选探索、战斗等路线，不要求先种田。命令通过已有 mc_do 的 chat 步骤发送，不建立第二个身体。
mc_tool_help 查 MCP 参数，mc_help 查原生动作。mc_qiandengji state 仅返回本连接已收到的私有包缓存，不发命令刷新；缺失或过时的魔力、技能、冷却仍未知。
默认展示以服务器版本为准；程序确需字段时显式用受支持的 --json，例如 /mycli status --json、/mycli skills status --json。其他命令按实际帮助，不读取全目录。
动作发出不等于成功；核对原ID终态、本人服务器回执和实际变化。冷却中按回执等候，超时结果未知先查询，不重发。保护多个目标用 protect batch，deny停止、unknown不算授权。
试炼塔arena按层、遗迹地下城dungeon逐室；本人参战、主线毕业和专项完成分别核验。公共补给guild shared；普通大背包、任务袋、个人奖励箱各自独立。拍照photo menu无需空地图，成片入个人奖励箱。
接单、学习、交付、施法、领奖或传送由当前目标决定。私聊用原版/msg，不向公屏转发工具反馈。更多玩法和故事在游戏里学。
`;
