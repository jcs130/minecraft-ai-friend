# 千灯纪完整网页观战

2026-10-22。原角色的 Mineflayer连接 → 本机原生 Three.js数据宿主 → 出站WSS →
网站登录鉴权 → 原版完整网页。没有第二个Minecraft观战账号，没有新模型或记忆循环。
发布进程不获得控制租约，只读取已有本机观战源。现役角色和既有Eye配对不迁移、不删除。

## 目前接线和验收

已实现完整渲染器、同UUID原始地形/实体、真实库存/原生窗口、本人技能魔力和聊天。
独立门户真实Cookie登录 → 实服Paper1.21.1的SDK同一身体 → WebGL地形/本人/46槽背包、
21,261个模型/263,070三角形、所有实际占用快捷栏图标解码、退出登录拒绝私有回读通过。
刷新网页元数据不会替换原iframe。六份特色装备/背包图标也分别解码验证。
桌面与390px浏览器检查不等于手机真机或Java完整场景像素一致；未支持的专用模型仍明确不可用。

原有`player_head`和`blaze_rod`物品组件正确。先前遗漏的是GUI目录与激活绑定，
本版独立目录自动随宿主验证结果激活：大背包匹配原profile纹理，法杖匹配实际731004，
其他四件武器匹配各自原编号。不能按名字猜图，也不能将未知物品映射成原版替代品。
PNG、JSON、mcmeta、原GLSL和声音都经限制路径和原始摘要链；发布端HTML/JS一律不能进入网站。

网站接线在另一个维护工作区，默认仍关闭，须按其发布流程部署静态成品、
启用`live.native3dEnabled`与Nginx WS/SSE。本机隔离验收不等于正式网站已上线。
生产状态以网站维护文档`paper/docs/WEB_SPECTATOR_HANDOFF.md`为准。

## 原角色启用观战

使用新的可选观战包；原Skill1.0.0 ZIP不修改，默认无画面行为保持。
复制原角色的客户端配置到同一目录，保留`dataDir`、用户名和原私有登录配置。
只增加`world.viewerPort:3007`及`world.nativeView`，见包内`client.json.example`。
MCP入口选择本包`body/qiandengji/entry.mjs`，环境变量
`QD_NATIVE_VIEWER_CONFIG`指向本包`viewer-config.json`。同一角色只启动一个MCP身体。

注册状态频道必须等PLAY和实际角色实体就绪，不能因为离线UUID已计算出来便提前发包。
模组网关继续用自己的`native-mineflayer.mjs`和匹配的原生注册表，不能套本包原版资产。
本版可选默认接线针对现役Paper1.21.1。

网站主人登录后创建本人角色的观战频道，将仅显示一次的`pub_`发布凭据保存在私有文件。
按示例填写`sourceUrl`、网站域名、频道ID和Token文件；然后运行：

```text
node tools/publish_mc_spectator.mjs <私有spectator.config.json绝对路径>
```

发布脚本不启动游戏，也不读模型Key。发布Token不放URL/聊天/命令行；Windows推荐DPAPI，
Linux文件须600。进程只出站复用网站HTTPS443，本机viewer仅回环；无需新增公网端口。
断流会退避重连，正常角色重连后重新读取当前状态，不重投任何游戏动作。

## 网站权限与维护

完整3D包含本人的菜单、背包与聊天，目前只允许真实主人/管理员观看。
原公开JPEG频道不自动获得公开3D授权。网站Cookie/PAT/游戏密码/发布Token分别作用，
不能互换。每5秒重验发布Token和观看会话；轮换凭据、撤权或退出登录结束旧流并清空画面。
多个网页复用同一身体，源端最多4个SSE观看者、24个活动素材读取与256个有界请求。

共享代码与六份 GUI 原素材已推送 `mc-visual-console/main`：
`c23fd08931e13cea7a54ae8fcef234ffccc9753f`。可选冻结目录使用
`E:/MC/integrations/qiandengji-web-view-20261022`，构建时逐一验证 8,451 份原版素材；
包内 `manifest.json` 固定双方源码提交、SDK 原包与网页 bundle 摘要。

源代码：`integrations/qiandengji-harness/viewer*.mjs`、`tools/publish_mc_spectator.mjs`；
门户薄适配：`integrations/portal-spectator/`；共享实现和原素材：`mc-visual-console`。
`tools/build_qiandengji_web_view.py`只创建新冻结目录，不改世界、配置或服务。
原Agent的模型、人设、长期记忆及既有动作账本由原宿主继续管理。

实测SDK角色沿用原战术反射，期间曾自动避敌/战斗，生命、位置、经验和所得物变化也进入网页；
没有付费模型调用，不把此次画面/接口测试当作长期自主游玩成功率。首次环境变量未传下去、
提前注册频道、资源路径遗漏和截图API用错的失败证据均保留在私有research。
原始包、完整库存/聊天、凭据、截图、Node二进制与生成bundle不进入Git。
