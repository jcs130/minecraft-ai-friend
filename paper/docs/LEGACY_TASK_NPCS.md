# 退役旧委托 NPC

AgentFriend 可在 `plugins/AgentFriend/config.yml` 分别退役剧情人物和生活导师。

```yaml
legacy-task-npcs:
  story: true
  life-guild: true
```

这两项默认关闭，正式启用时正常存档、停服并备份到 F 盘，再安装对应插件与配置。开关在启动时读取。旧实体在启动或所在区块的实体载入后清退，清退期间无需强制加载未访问区块。

- 剧情撤下在官方剧情配置和身份登记中同时确认的旧村民。旧剧情及进度仍能通过旅途手记使用。到原剧情地点 8 格内打开留言，或执行 `/mycli world story talk <id>`。用 `/mycli world story info <id>` 查看坐标。远处查询不会计作完成。
- 生活公会撤下七位按任务标志登记的导师及其导师交易。建筑、入口、保护和委托进度继续有效。用罗盘的生活公会页面或 `/mycli life board` 查委托，用 `/mycli life status` 看进度，达成后通过菜单或 `/mycli life claim` 交付。
- 交易和补给请到常规商贩或冒险者公会接待处。

F 盘的停服备份需包含原插件、`config.yml`、`rpg-story-npcs.yml`、故事账本和世界实体区块。需要恢复时，先停服并关闭相应退役开关，再从该备份按原 UUID 恢复退役实体；恢复剧情实体时保留其原有登记 UUID。有新进度的存档仅回填这些实体记录，玩家数据、任务账本、区块方块和其他实体沿用当前存档。完整冷备只供明确选择回退整个维护时段时使用。
