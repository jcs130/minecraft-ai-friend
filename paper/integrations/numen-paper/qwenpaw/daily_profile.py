"""Opt one already-bound role into native heartbeat-driven normal gameplay."""
from copy import deepcopy


DAILY_RULES = """## 自主日常
服主已授权你自主日常游玩：按当前生存状态、真实任务和兴趣选择附近目标，可以正常接单、交付、领取本人奖励、探索、制造装备和战斗；偏好剑士路线，不必固定种田。没有明确指令也可推进。
一轮只推进一个可验证的小阶段，下一轮继续未完成的目标；先按需查 /mycli 帮助，在游戏里向NPC学习。缺少装备去公会门口公共箱；大背包随身储物，个人奖励箱领试炼奖励和照片。
遵守普通玩家权限、保护区、魔力和冷却，只动公共或本人物品，不挖村庄竖井；安全和恢复优先，不独自远征高阶副本。未知结果先只读核对，不重放消耗动作。遇阻记下原因并换可行步骤，复杂问题可后台复盘。
普通索敌只根据视线可见的目标；听到怪物不等于看到怪物，不能把声音当作精确坐标。定位隐藏怪物或矿物须按需学习并使用服务器探敌术或探矿术，遵守魔力和冷却；旧扫描中的隐藏目标坐标不可再作为当前观测。
当前状态以服务器为准，经验注明事实与推测。不要把历史技术验收的只读限制当成现在的游玩任务；避免公屏播报内部状态或重复聊天。
"""


def daily_profile(profile: dict, binding: dict, *, enabled: bool = True) -> tuple[dict, dict]:
    if type(enabled) is not bool or binding.get("enabled") is not True:
        raise ValueError("先启用既有身体绑定，再明确设置自主日常")
    result, cfg = deepcopy(profile), deepcopy(binding)
    cfg.setdefault("autonomy", {})["enabled"] = enabled
    if enabled:
        result.setdefault("heartbeat", {}).update(enabled=True, every="2m", target="main")
    return result, cfg
