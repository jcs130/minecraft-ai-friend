# 桐人左臂抬高 · 根因与修复（2026-11-22）

## 现象与结论

用户反馈桐人模型"左胳膊抬的太高"。定位结论：加密原模型 `qd_hub_kirito.ysm` 不可直接编辑；
手臂姿态由客户端 `qd_kirito_motion` 模组的七段第三人称动作关键帧控制。抬臂来自两处：

1. **历史 idle 姿态**：代理骨架上臂 bind 轴每侧外展约 38°。未做 bind 修正时 idle 左臂外展
   **42.7°（近横抬）**，即"抬太高"的姿态（见 `frames/idle-final.png`）。2026-11-20 的
   `author.py` 修正循环（idle −24°）已将其降到 18.7°（`frames/take-idle-020.png` 下垂正常）。
   若客户端仍见横抬，说明其 kirito-motion JAR 早于该修正，或动作未生效。
2. **持剑段左臂不受控**：`hold_mainhand:sword` 原先只含右臂四骨
   （RightShoulder/RightArm/RightLowerArm/RightHand），左臂沿用加密原模型的该状态动画，
   是唯一左臂姿态不可控的缺口。

## 本次修改（仅编辑可改的动作层，未触碰加密 .ysm）

源：`paper/integrations/desktop-client/kirito-motion/`

- `resources/assets/qd_kirito_motion/animations/kirito.animation.json`
  - idle：LeftArm / RightArm 全部关键帧 Z 再 ±6°（左 19→25，右 −19.5→−25.5），
    左臂外展 18.7°→**12.8°**、右 19°→13.2°（对称、更贴身下垂）。
  - `hold_mainhand:sword`：新增 `LeftShoulder [0.5,0,-1.7]`、`LeftArm [-3,4,25]`、
    `LeftLowerArm [-8,2,1]` 静态放松轨道（外展 12.8° 下垂）。`Motion.attach` 会追加这些
    remaining bones，从而覆盖原模型左臂。
- `kirito-motion.bbmodel`：同步 idle 上臂关键帧与持剑左臂 animator（代理预览，非权威）。
- 七段 clip、`animation_length`、catmullrom 平滑均保留；新增静态数组轨道与
  `Motion.curve` 的单键分支兼容。

调参脚本（一次性，含数值验证）：会话工作区 `tune-kirito-left-arm.js`。
修改前备份：会话工作区 `kirito-arm-backup/{kirito.animation.json.bak,kirito-motion.bbmodel.bak}`。

## 验证

数值标定（bind 肩→肘向量外展 37.9°；YSM 有效 Z = −JSON_Z，与 studio 渲染对照校准）：

| 状态 | 左臂外展角（偏离垂直向下） |
| --- | --- |
| 修正前 idle（横抬缺陷） | 42.7° |
| 上一版 idle | 18.7° |
| 本次 idle | 12.8°（右 13.2°） |
| 本次持剑左臂（首次受控） | 12.8° |

结构校验：7 段 clip 齐全；idle 首键 `[-3,4,25]`/`[3,-3,-25.5]`；持剑含左三骨；JSON 可解析、数值有限。
**边界**：本次微调未做 live 客户端渲染目视确认（studio 渲染管线需隔离 MC 客户端）；
需用户进服目视确认左臂下垂。未对生产服务器做任何写入。

## 交付与部署

- **即插即用（推荐，无需重建/重装）**：桌面 `桐人左臂修复/kirito.animation.json` + `说明.txt`。
  复制到游戏实例 `config/qd_kirito_motion/kirito.animation.json` 并重启客户端。
  现有 kirito-motion JAR 的 override 通道允许同键覆盖，故旧 JAR 也能立即生效。
- **操作者重建 JAR**（本机缺 classpath/YSM JAR，未在此重建）：
  `python paper/integrations/desktop-client/kirito-motion/build.py --classpath-file client-classpath.txt --ysm ysm-2.6.5-neoforge+mc1.21.1-release.jar --out kirito-motion-1.0.0.jar`
  随后按 desktop-client `build.py` 重新打包并 bump 整合包版本，使新客户端默认带修正。
- 回滚：删除客户端 override 文件，或恢复上述 `.bak`。

## 许可与署名

原模型/原始动画 PoshGiraffe0（CC BY-NC-SA 4.0）；七段动作与适配器 qiandengji（CC BY-NC-SA 4.0）。
`ATTRIBUTION.txt` 未改动；本次为同许可下的衍生调整，保留署名、非商业、相同方式共享。