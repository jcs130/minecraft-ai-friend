# 飞行控制与观测

核心只消费本人的 Minecraft `abilities` 包。服务器资料包可以提供明确的到期时间；核心不推断法术、时限或魔力，不调用模型。先施法只是获得许可，`mc_state` 的 `flight` 区分许可、客户端飞行状态、服务端 flying 标志和当前控制方式。

## 两种移动方式

- `control` + `mode:"flight"`：forward/back/left/right 按当前水平朝向移动，jump 上升、sneak 下降；可以同时按水平和升降键。forward+sprint 将水平速度提高到普通控制的两倍，不改变升降速度。斜向只归一化水平轴。每段 50–2000 毫秒，可在同一执行批次组合多个短段。
- `flight`：按已加载地形试算坐标路线。不会伪造 WASD 输入。`flight_plan` 可在施法前预览多段路径；有期限时预留落地和施工时间，再提交带前置条件的连续步骤，减少许可期间的模型等待。

示例步骤：`{"skill":"control","mode":"flight","keys":["forward","jump","sprint"],"durationMs":500}`。通过公开 SDK/MCP 的 `mc_do` 提交；受理不代表完成，仍须等待执行终态并核验实际位置。

控制沿用保守的 `min(0.3, flyingSpeed*3)` 格/50ms 移动率（无速度包时默认 0.05），未实现完整原版惯性物理。加速路径逐小段检测玩家碰撞体，遇到障碍或未加载区域停止；受服务端校正和规则约束。取消会松键，通常保持悬停；停止飞行、到期、断线、死亡、重生或服务端纠正会交还物理控制，旧任务不能重新移动。

## 可视化

通过共享 viewer 的可选 `getFlightState` 回调提供中立数据。界面区分“尚未起飞 / 按键飞行 / 坐标飞行 / 悬停”，展示许可剩余时间和客户端升降方向。按键来自真实控制器；坐标路线不点亮未按下的键。旧宿主无回调时不显示推测的飞行信息。遥测不是服务端到达证明。

参考：[Mineflayer creative 实现](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/creative.js)、[Minecraft 操作说明](https://www.minecraft.net/en-us/article/minecraft-controls)。这两处资料与现有源码核对后采用上述有限控制方案；没有将 creative.flyTo 当作完整键盘物理。

离线回归覆盖升降与水平组合、朝向、加速、斜向速度、碰撞、等待取消、失去权限、到期、死亡、重生、断线、位置纠正、停止不复活和真实输入可视化。实际服务器游玩效果须在加载候选包后另行验收。
