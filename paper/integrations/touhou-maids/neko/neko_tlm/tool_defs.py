"""酒狐插件工具说明，按千灯纪 mc_maids 能力注册。"""

from typing import NamedTuple


class Tool(NamedTuple):
    name: str
    requires: tuple[str, ...]
    handler: str
    description: str
    properties: dict
    optional: tuple[str, ...] = ()

    def schema(self) -> dict:
        return {
            "type": "object",
            "properties": self.properties,
            "required": [name for name in self.properties if name not in self.optional],
            "additionalProperties": False,
        }


TOOLS = (
    Tool(
        "mc_maid_status",
        ("context", "inventory"),
        "status",
        "查询绑定女仆的实时位置、维度、生命、坐姿、任务和本插件能调用的工具。",
        {},
    ),
    Tool(
        "mc_maid_inventory",
        ("inventory",),
        "inventory",
        "读取本人原生背包及可用格，装备前查询。",
        {},
    ),
    Tool(
        "mc_switch_follow",
        ("follow", "stay"),
        "follow",
        "主人要求跟着他时用 follow，留在原地用 stay。回执只确认模式已切换。主人离线时没有可追随目标。",
        {"action": {"type": "string", "enum": ["follow", "stay"]}},
    ),
    Tool(
        "navigate_maid_to_coordinates",
        ("walk", "receipt"),
        "walk",
        "让女仆寻路前往已明确的同维度 x/y/z。先用 mc_maid_status 读取维度。目标区块须已加载，最多 96 格。"
        "寻路接受后用 mc_maid_action_result 查询原请求号。只有回执报告 goalCompleted 和实际到达坐标时才说已到达。",
        {
            "x": {"type": "number"},
            "y": {"type": "number"},
            "z": {"type": "number"},
            "dimension": {
                "type": "string",
                "description": "mc_maid_status 返回的维度 ID",
            },
        },
    ),
    Tool(
        "mc_stop_maid_activity",
        ("stay",),
        "stop",
        "停止当前寻路或随行，女仆坐下。原移动请求仍可按原请求号查询。",
        {},
    ),
    Tool(
        "mc_maid_action_result",
        ("receipt",),
        "result",
        "只读查询原 request_id 的真实回执。需要等待到达时传 wait=true，最多等待 32 秒。"
        "unknown 表示执行不确定，继续查询同一个 ID。不要在未知时重发动作。",
        {
            "request_id": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,48}$"},
            "wait": {"type": "boolean"},
        },
        ("wait",),
    ),
    Tool(
        "mc_maid_inbox",
        ("inbox",),
        "inbox",
        "读取主人尚未确认的原始游戏对话，保留真实发送者和事件 ID。用于查询历史消息。只执行主人本轮明确提出的动作。",
        {},
    ),
    Tool(
        "mc_send_chat",
        ("speak", "inbox", "ack"),
        "speak",
        "用女仆原有的游戏文字、气泡和声音路由说一句短话，附近可见玩家可能收到。"
        "答复本轮游戏对话时传原 event_id，发送回执确认后才确认收件。交付回执不能证明玩家听到了声音。",
        {
            "message": {"type": "string", "minLength": 1, "maxLength": 140},
            "event_id": {"type": "string"},
        },
        ("event_id",),
    ),
    Tool("mc_maid_tasks", ("tasks",), "tasks", "读取原生工作模式及其启用状态。", {}),
    Tool(
        "mc_switch_task",
        ("tasks", "task"),
        "task",
        "从 mc_maid_tasks 返回且已启用的 ID 中选择工作模式。已切换只表示设置成功，工作进展需要另行观察。",
        {"task_id": {"type": "string"}},
    ),
    Tool(
        "mc_equip_item",
        ("inventory", "equip"),
        "equip",
        "把女仆本人背包中已确认的格子与原生装备槽交换。",
        {
            "slot": {"type": "integer", "minimum": 0},
            "hand": {
                "type": "string",
                "enum": ["main", "off", "head", "chest", "legs", "feet"],
            },
        },
    ),
    Tool("mc_maid_spells", ("spells",), "spells", "读取此私人女仆原有法术与法力。", {}),
    Tool(
        "mc_cast_maid_spell",
        ("spells", "cast"),
        "cast",
        "使用 mc_maid_spells 列出的原私人伙伴法术 ID。施放按原执行器回执报告。仅在主人本轮明确要求时使用。",
        {"spell_id": {"type": "string", "pattern": "^[a-z0-9][a-z0-9_-]{0,47}$"}},
    ),
)
