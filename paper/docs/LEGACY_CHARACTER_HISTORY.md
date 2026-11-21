# 历史角色目录合并

一个角色目录可以为已审查的旧 UUID 指向一个明确的现行 UUID。原登录账号、背包、权限、领地、玩家存档、任务与控制回执仍按各自真实 UUID 保存。

## 准备与审查

1. 从该服务器当前可信身份登记中读取双方原始记录，核对同一网站所有者和真实服务器 ID。各行保存 uuid、ownerId、identitySha256 和 state。摘要对应独立原始身份记录及其版本。目录角色名、相同皮肤或曾在同一机器运行均不足以确认归属。
2. 在计划内由运维指定一条 authoritative 身份，状态为 active。history 中每条旧身份的状态必须已经是 archived，仍在活动或归属未证实的身份留待复核。计划根字段为 schemaVersion、realmId、notBefore、expiresAt、roles，两个时间使用毫秒时间戳。各角色行只填 authoritative 和 history。
3. 将计划和独立身份登记证据分别交给离线签名器。网站后端只加载已审查计划与公钥。签名命令仅输出结果，不改账号数据库或游戏文件。

```powershell
node scripts/character-history.mjs sign reviewed-plan.json verified-proofs.json operator-ed25519-private.pem
node scripts/character-history.mjs verify approved-envelope.json operator-ed25519-public.pem
```

运维人员核对输出中的双方 UUID、有效期和记录摘要后交付给网站。

## 托管接入

在网站的可信装配层创建 characterHistoryCatalog，传入签名文件、公钥、当前真实 realmId 及按所有者和两条 UUID 回读最新绑定记录的 readProofs。向 createPortal 可选传入其返回值 characterHistory。原角色目录仍根据当前账号归属和身体服务检查结果展示。

已登录的本人可向 GET /api/v1/character-bodies/catalog/{uuid} 发送请求。通过双方记录核验的历史地址得到站内临时重定向。控制和结果查询继续要求原角色及原请求编号。过期批次、记录变动、两条角色同时活动或目标归属撤销时，旧地址不再重定向。撤回可停用候选并保留审核资料。

如需保留旧角色的经历，从源档案筛选有证据的长期事实，归档时保留出处并按同一角色去重。动作回执和进行中的任务无需重放。
