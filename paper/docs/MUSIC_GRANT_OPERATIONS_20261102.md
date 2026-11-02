# 歌曲发布授权的服务器代办

服主可明确委托维护者，为**已经归属原网站账号的一个角色**签发独立的 `music.write` 授权。维护者使用本机工具，不冒充角色主人的网站会话；审计动作是 `music.credential.operator_issue`，审计用户为空，凭据仍绑定原主人与真实角色 UUID。

入口是 `paper/integrations/agent-portal/scripts/issue-music-grant.mjs`，需要 Node 22.13+，没有额外依赖。它不被 HTTP、MCP、游戏 CLI 或启动脚本引用。安装文件不执行签发，也不需要重启官网或游戏服。

## 接收方与维护者各自准备

1. 接收方在自己的私有目录生成 RSA 3072 位或更大的密钥，只提供 SPKI `PUBLIC KEY` PEM 与 SHA256 指纹。指纹是 SPKI DER 的 SHA256，私钥始终留在接收方本机。较长的多字节角色名可能需要 4096 位密钥；`RECIPIENT_KEY_TOO_SMALL_FOR_SUBJECT` 时换更大的公钥后重试未签发请求。
2. 维护者核对真实服主委托、接收方身份及公钥指纹，将请求保存在仅维护账号可读写的目录；数据库使用正式路径，基线使用已核验的原归属快照。不能用 QA 数据、旧角色或新建空账号代替。
3. 每次新委托使用独立 `requestId` 与 `stateDirectory`。未知结果只恢复同一请求，不删除回执或更换目录重复签发。

私有请求文件结构如下；其中 UUID、路径、指纹都必须替换为该次已核实的值，示例不能直接执行：

```json
{
  "databaseFile": "/private/portal.sqlite",
  "baselineDatabaseFile": "/private/ownership-baseline.sqlite",
  "recipientPublicKeyFile": "/private/recipient-public.pem",
  "recipientFingerprint": "<SPKI DER SHA256，64位小写十六进制>",
  "stateDirectory": "/private/music-grant-request",
  "approval": {
    "source": "server-owner-delegation",
    "requestId": "22222222-2222-3222-8222-222222222222",
    "subjectUuid": "11111111-1111-3111-8111-111111111111",
    "scope": "music.write"
  },
  "subject": {
    "uuid": "11111111-1111-3111-8111-111111111111",
    "name": "ag_Example"
  }
}
```

核实之后才显式执行：

```sh
node issue-music-grant.mjs --execute --request-file /private/request.json
```

参数只有私有请求文件路径，不传密码或令牌。无参数只返回维护者用法，不签发。正式运行应沿用原维护账号与私有目录权限，不为方便执行而开放数据库目录。

## 行为、回执与恢复

工具先验证基线的原主人，再在 SQLite 写事务中核对当前归属。授权固定为单角色、仅 `music.write`、有效期30天；不扩权旧令牌，不更换密码、角色 UUID 或主人。其他原凭据在事务内逐项摘要核验保持。

令牌只在进程内出现，数据库保存摘要；落盘的 prepared 回执只有摘要和接收方公钥加密的密文。跨会话只可传递返回的 `envelope`，使用 `RSA-OAEP-SHA256` 解密。接收方核对解密后的角色 UUID、权限与期限，把令牌存到原客户端私有凭据文件，不能贴进聊天、模型提示词、命令参数或 Git。

`grant.prepared.private.json` 是恢复依据：同一请求重试返回同一份密文，不重复建凭据。撤销、过期、归属变化、请求或接收公钥改变都会拒绝；需要新授权时重新取得明确委托。`grant.completed.private.json` 记录完成情况。出现错误不代表事务一定未提交，必须先检查同一 prepared 回执；不要创建另一组请求试错。`apiVerified:false` 表示还未完成真实客户端 API 验证，不能当成歌曲发布成功。

接收方后续按[歌曲作品契约](MUSIC_WORKS_20261102.md)上传已采用的成品，核对作者、歌词与摘要后明确公开。私有草稿不会自动公开。源码和工具部署不代表真实歌曲已上传，也不代表语音听审通过。
