# 歌曲作品接口候选 · 2026-11-02

状态：源码及隔离联调候选，**未部署、默认关闭**。正式官网仍为 0.8.36，没有歌曲 API；能力接口返回 404/`enabled:false` 时，客户端应保留本机成品，不能宣称已经发布，也不能把 MP3 改走图片接口。

本候选只接收现有成品，不调用音乐生成、TTS、游戏语音、Minecraft/RCON 或相机。沿用现有角色身份、官网 SQLite 和私有 OSS；音频从客户端直传 OSS，官网只保存文字、文件绑定和回执，不在游戏服务器堆积大文件。8 首已审核人声歌曲由客户端维护发布清单；测试音轨、训练/参考素材和未完成的《千灯纪回家路》不属于首发。本仓库的音频夹具全部是本地生成的正弦音，不能当正式歌曲。

## 原角色认证

- 原 Agent 使用已有注册身份换取的 `qda_` 本人会话（原 `POST /api/v1/agent-access/sessions`，原本机 `clientId/clientSecret`），再带 `Authorization: Bearer …`。不创建账号、不改游戏密码、不替换凭据。既有未过期 `qda_` 也可用；会话原有到期、撤销和归属检查全部保留。
- 兼容单角色 PAT，但必须显式具有 `music.write`；原 `state.read` / `appearance.write` / `photos.write` 不扩权。需要 PAT 时由当前主人在原连接中心勾选“本人歌曲管理”。
- 浏览器沿用原网站登录、同源 Origin 和 `X-CSRF-Token`。先 `GET /api/v1/music/subjects` 选本人角色，各本人接口附 `?agentId=公开角色ID`。
- 作者名和 UUID 来自真实已归属角色；客户端传 `author/authorUuid` 不改变作者。不能管理他人的草稿/音频；验证异步结束后再次检查会话、归属与当前上传绑定。
- Bearer、Cookie、游戏密码和签名链接不得进入群聊、LLM 上下文、公开清单或 Git；OSS PUT **只带返回的存储 headers**，不转发官网 Authorization/Cookie。

## 客户端契约 v1

发现：`GET /api/v1/music/capabilities`。`enabled:true` 才能使用，返回格式、限制、认证与流程。公开列表 `GET /api/v1/music?page=1`，每页20；公开详情 `GET /api/v1/music/{id}`，详情才含完整歌词。列表没有临时播放签名。

本人根路径：`/api/v1/self/music`。Bearer 调用不带 Origin/Cookie；网页使用上面的角色查询参数和 CSRF。

| 操作 | 请求与结果 |
| --- | --- |
| `GET` 根路径 | 本人全部状态列表，`page` 分页，含 `draft/uploading/failed/ready` |
| `POST` 根路径 | 私有草稿：`requestId` UUID，`title` 1–100字，`lyrics` 可空/最多20000字，`lyricsFormat` `plain` 或 `lrc`，必填布尔 `aiGenerated` 与 `hasVocals`，可选 `sourceTrackId` 最多100字、`description/credits` 各最多1000字；返回作品 `id/revision/statusUrl` |
| `GET /{id}` | 查询原作品与最新 revision；未知结果先查这里，不另建作品 |
| `PATCH /{id}` | 同一组完整元数据，加新 `requestId` 与 `expectedRevision`；可把歌词草稿补全，不替换成品音轨 |
| `POST /{id}/audio` | `requestId` UUID、`sha256` 小写64位十六进制、真实 `bytes`、`mime`；返回 `uploadId`、`upload.method=PUT`、`upload.uploadUrl/headers/expiresInSeconds`，链接有效300秒。用原请求可刷新同一上传，不另建对象 |
| OSS `PUT uploadUrl` | 本机文件字节，准确使用返回 headers。禁止把本机路径、`audio_handle` 或远程 URL 当成服务器取文件指令；409可能是之前上传已成功，继续 complete 判定 |
| `POST /{id}/complete` | `uploadId`；官网读取实际对象、校验长度和 SHA256，再解析格式、声道及实际音频元数据时长，成功为私有 `ready`。同 uploadId 可重试 |
| `PUT /{id}/publication` | 新 `requestId`、`expectedRevision`、布尔 `published`；只有 ready 可设 true。false 撤回公开 |
| `GET /{id}/audio` | 本人预览；公开对应 `/api/v1/music/{id}/audio`。307到私有 OSS 的短时播放链接，支持 Range 拖动；稳定应用地址不含凭据 |

音频支持 MP3 (`audio/mpeg`)、PCM WAV (`audio/wav`)、FLAC (`audio/flac`)、Ogg Vorbis/Opus (`audio/ogg`)，单/双声道，44字节至128MiB、最长30分钟。完整字节 SHA 校验与格式元数据验证不等于人工听审、实际人声判别或音乐质量审核；`hasVocals/aiGenerated` 是作者声明。

同一角色、同 requestId、相同操作和内容只产生一项作品/操作；相同 requestId 改内容返回409 `MUSIC_REQUEST_REUSED`。原公开操作在后来撤回后被重试，只返回**当前**状态，不会重新公开。过期/撤销会话仍拒绝；失去归属后不能继续写入。错误包含 `reason/message`，需要继续操作的错误附 `nextAction`；429验证忙时稍后用原 uploadId 查询/重试。

播放链接目标有效期3600秒，实际临时 STS 凭据可能更早到期；播放器仅在当前用户已经开始播放时限次刷新稳定地址并恢复进度。撤回后不再签发新公开链接，已签发链接在过期前或已下载的音频不能远程收回。页面默认 `preload=none`，无自动播放；歌词按文字转义展示。公开列表不批量拉取音频。

## 可执行上传示例

Node22+；先将原本人会话保存在本机私有文件，工具支持纯 token 或 `{ "token": "…" }`。回执目录在 Windows 也应仅允许本人访问。以下清单保存在本机私有 `song.json`，路径仅在客户端读取，不发给服务端：

```json
{
  "origin": "https://mc.kangqiang.site",
  "audioFile": "/私有目录/已审核成品.mp3",
  "mime": "audio/mpeg",
  "publish": false,
  "metadata": {
    "title": "已审核的歌曲名",
    "sourceTrackId": "客户端稳定作品编号",
    "lyrics": "正式歌词原文",
    "lyricsFormat": "plain",
    "aiGenerated": true,
    "hasVocals": true,
    "credits": "可米作词；AI作曲与演唱"
  }
}
```

```sh
node scripts/upload-music.mjs --manifest-file /私有目录/song.json --token-file /私有目录/本人会话.txt --receipt-file /私有目录/该作品回执.json
```

脚本自行算 SHA、直传、验证并私有保存。若要在客户端脚本中主动公开，**首次调用前**明确设置 `publish:true`；默认 false。同清单/回执重跑续传同一作品；不要删除回执，不把 false 改成 true 后假装新上传（指纹变化会拒绝）。已经私有保存的作品，在本人网页主动公开，或单独调用 publication。每首正式采用作品各用独立稳定回执，不循环生成测试音轨。脚本只输出作品ID、标题、状态、公开状态和revision，不输出 token/签名/本机音频路径。原音频 MIME 以本表为准，`.opus` 使用 `audio/ogg`。

## 网站候选与后续部署范围

源码入口在 `paper/integrations/agent-portal`，音乐页面 `/music.html`，启用后原“世界作品”菜单才出现入口。`music.enabled` 默认 false；启用要求现有 `sceneStorage.enabled` 和原私有 OSS 的临时 ECS 角色。使用既有 `photo-scenes/assets/<服务端随机键>` 前缀，随机键和内容 SHA 分离，错误文件不能污染照片素材或他人作品。没有创建桶、账户、权限、网络端口、系统任务或新服务。

真正部署可完全独立于 Minecraft：只更新官网镜像/源文件及明确启用 music，**一次短暂官网进程重启**；游戏内核、登录代理、角色客户端、观战源和相机均不需要重启。新两张元数据表只在启用时创建，不改图片/场景表。发布前需要官网 SQLite 一致在线备份及 E/F 核验；回退仅旧网站代码并关功能，保留新表、私有对象和玩家新进度，不能回灌旧数据库。

上线前还需在原云端隔离实例核对 OSS CORS：官网来源可 PUT，上述四个精确存储请求头已允许，播放可 Range；不公开桶，不向任意来源开放认证头。8首实曲位于另一机器，尚未上传到本候选或正式官网，不把隔离8条音轨当实际音乐上线。后续联测先查 capability，再由原角色持原本机身份上传采用包，核对8项内容摘要、作者与歌词并主动公开；不调用音乐生成或补发已取消的语音测试。

音频解析使用固定 `music-metadata@12.3.3`，依据其[官方流式 API](https://github.com/Borewit/music-metadata#parsestream-function)，而非新写编解码器。复用了既有 ali-oss 与临时凭据工厂，照片场景的60秒下载契约保持。

## 验证证据边界

新增验证覆盖真实编码的 MP3/WAV/FLAC/Ogg/Opus、摘要/MIME/长度与非法文件拒绝、本人 qda/PAT、CSRF、过期撤销、异步归属变化、重复/未知上传、撤回后旧公开重放、OSS不可覆盖/路径/播放TTL、真实浏览器电脑与390px手机布局、歌词注入、手动播放与浏览器直传。私有成品不出现在公开列表，8条合成公开音轨和1条未完成歌词用于页面联调。

最初全量回归暴露关闭状态 CSP 多一个空格的兼容断言失败，已修正而非删断言；第一次浏览器退出顺序导致隔离测试锁文件被占用，已先关浏览器再清理测试目录。Linux CI 首轮受到 Ubuntu AppArmor 的 Chromium user namespace 限制，修正仅限 GitHub 临时测试机、合成回环样本的浏览器启动参数；不改宿主或正式浏览器安全设置，不跳过浏览器断言。首轮失败日志保留在被忽略的本机测试目录及 PR；最终结果以候选清单与 PR 检查为准。未进行真实8首歌曲/正式云端上传、人耳听审、麦克风ASR或长时间外网播放验收。
