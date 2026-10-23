# 官网登录保护与插件直下

2026-10-23 源码候选 **0.8.6**。正式网站仍为 0.8.4；本文件的实现、检查与云端上线分别记录，不能把源码存在当成生产已生效。

## 已查明的问题

旧网站已有内存计数：同一 IP＋用户名 15 分钟 12 次、同一 IP 40 次。因此连续六次 401 不能证明没有限流。不过缺少失败冷却，IP 与用户名绑定的计数可被换 IP 绕开，进程重启后也丢失；用户名和已验证邮箱别名没有合并预算。

CSRF 保护跨站请求，不能阻止直接访问网站的自动化登录；保留它并增加登录节流。设计依据见 [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#login-throttling)。

## 当前候选策略

窗口为 15 分钟，密码验证前原子预留次数，并发请求不能同时通过旧计数。未完成的尝试保守计入；只有真实密码验证成功才清理相应计数。

| 范围 | 规则 |
| --- | --- |
| 同一来源 IP＋账号 | 第 3 次后冷却 1 秒，第 4 次后 2 秒，第 5 次后暂缓 5 分钟 |
| 同一账号，跨 IP | 10 次尝试后暂缓 1 分钟，减少分布式尝试 |
| 同一来源 IP，跨账号 | 30 次尝试后暂缓 5 分钟；成功登录不清除此预算 |

被拒请求返回 **429 / LOGIN_THROTTLED**，附 `Retry-After` 秒数与同值 `error.retryAfterSeconds`。被拒的请求不延长等待时间。普通错误统一 401 / LOGIN_FAILED，不区分账号不存在或密码错误；不存在账号的有效密码输入也执行同一 scrypt 验证流程。

- 依据认证后的 owner ID 合并用户名大小写与已验证邮箱别名。未确认的名称保持未知，不借名称授予身份。
- 网站登录、再次验密、修改网站密码、确认邮箱绑定共用密码预算。游戏登录与 Agent 的高熵 API 凭据不改协议。
- 计数存于 SQLite `login_throttles`，使用服务器盐散列键；不保存密码、原始 IP 或输入名称。进程重启后保留，过期清理，上限 20,000 项。
- 来源继续使用既有可信代理判定，不信任访问者自己填写的 X-Forwarded-For 前缀。
- 已登录的会话继续有效；密码等待不等于踢出游戏或改动玩家密码。网站无需增加验证码交互。

## 下载中心

`/downloads.html` 提供我们维护的 Minecraft 插件，`GET /api/v1/downloads` 返回公开固定版本、大小、SHA256、平台、安装说明和开放状态。宿主本体保留项目链接，由用户自己提供。

| 自有发行物 | 公开版本 | 注意 |
| --- | --- | --- |
| Cortico World | 0.4.1-rc.14 | npm next 公测包；Cortico API 6、官方 0.2.5 已验收；Node 22+ |
| DSH Minecraft 适配器 | 0.3.0-rc.12 | npm 已发布候选；官方 DSH 0.2.1-rc.2、Node 24+；rc.13 邀请向导仍属源码开发版 |
| NEKO Minecraft Autonomous 插件 | 0.6.70 | `.neko-plugin`；已有配套运行环境时导入 |
| NEKO Windows 完整离线包 | 0.6.70 | 1,111,598,162 字节；完整解压运行一键安装，再导入插件；仍需自己的 N.E.K.O 和模型 |

只镜像原公开安装包的相同字节，不打包维护者工作目录、账号、模型 Key、角色存档或数据库。Cortico、DSH 的薄适配器仍需安装声明依赖；不宣称它们是完整离线环境。大文件不进源码仓库，仓库只保存发行清单与下载页面。

原四个 Skill 版本保持原字节；当前源码为 Skill 1.2.1 / 固定核心 rc.71，和通用核心 main 的 rc.72 分开。

## OSS 接入

下载链接继续使用网站原路径。设置镜像后返回 **307**，浏览器或下载器直接从对象存储取文件，网站不转发二进制。目标只由已审核发行清单和管理员 HTTPS 基址组成；请求里的 token、路径、Cookie、查询参数不拼入目标，重定向附 `Referrer-Policy: no-referrer`。

```json
{
  "downloads": {
    "baseUrl": "https://your-bucket.oss-cn-hongkong.aliyuncs.com/releases/",
    "enabledPackages": ["cortico-world", "dsh-adapter", "neko-plugin", "neko-offline"]
  }
}
```

默认基址为空、插件列表为空；未配置的包明确显示尚未开放，不生成可点但无文件的直下按钮。HTTPS 基址禁止凭据、签名查询、编码路径和任意请求参数。网站本身不需要 OSS 上传密钥。

在独立下载桶中保留桶默认私有，逐个公开已经审核的发行对象；不开放匿名写入或目录列举，不改变其他桶策略。对象键为 `releases/<SHA256>/<文件名>`，设置附件下载、正确 MIME 和长缓存，保留许可。私有资源、照片草稿和账号数据不加入镜像。OSS 的公开对象访问方式见[官方说明](https://help.aliyun.com/en/oss/user-guide/access-buckets-via-custom-domain-names)。

先以只读脚本生成并校验上传清单：

```sh
node scripts/download-manifest.mjs --base-url https://your-bucket.oss-cn-hongkong.aliyuncs.com/releases/ --include-packages --package-directory /absolute/reviewed-packages
```

脚本流式校验全部文件，不上传、不读取云密钥，也不发布整个目录。只有所有对象的远端大小、SHA256 和匿名 GET/HEAD 已确认后，才在网站开启对应 ID。保留上游地址作备份。关闭 `baseUrl` 即恢复原 Skill 本地下载；清空 enabledPackages 使扩展包恢复未开放状态。

此次只读检查：现有香港 ECS 配置 100 Mbps / 按流量计费，一次 3,867,516 字节 Skill 下载耗时约 0.73 秒（约 5.3 MB/s）。这不能代表其他地区或运营商；没有据此断言所有线路正常或承诺 OSS 必然提速。OSS 能分离网站出口，实际速度须上线后按目标网络复测。专用 OSS 的存储与下载流量按量计费，尚未开启 CDN 或传输加速。

## 验证与发布

隔离测试覆盖新 Cookie、大小写、邮箱别名、跨 IP、并发、持久化、冷却到期、验密替代入口、无登录下载、禁用状态、固定路径、GET/HEAD、页面渲染和查询参数不外带。下载文件与 npm integrity / GitHub 发行摘要逐一核对；扫描 3 层归档，保留原扫描与逐项处理报告。

完整 NEKO 包命中的 39 条已核对为 Chrome 扩展公钥、角色身份映射和原版声音／贴图目录键；没有修改包字节或放宽源码扫描规则，不将原始命中数称为零。

上线仅涉及网站容器及公开下载配置。替换前用 SQLite backup API 备份并检查完整性，保留当时所有用户、密码哈希、绑定、邮箱、邀请、客户端凭据、照片与回忆。确认已有用户的数据未被重写；不建立正式测试账号来验证暴力尝试。

回退保留最新 SQLite，正常切回旧网站镜像和下载配置；新增限流表可保留，不用旧数据库覆盖新注册或密码变更。Paper、登录代理、QwenPaw、玩家库存和正在运行的 Agent 不在此发布范围。
