# 使用千灯纪官网授权 N.E.K.O.

## 玩家

1. 在桌面 N.E.K.O. 的插件管理器导入千灯纪版酒狐插件 `1.0.7.1+qiandengji.3`。在插件配置中填写要使用的 N.E.K.O. 角色名。已有手动接入配置时，清空手动 API 地址即可切换为官网授权。
2. 启动插件并运行「官网授权」。浏览器打开千灯纪官网连接页。需要时用原千灯纪账号登录。
3. 选择自己的女仆，输入插件显示的六位连接码，点「确认连接此女仆」。回到桌面插件查看连接状态。也可以在官网连接页的「我的女仆授权」直接撤销。

授权有效期最长 24 小时，且随批准它的网站会话到期。撤销、退出该会话或游戏角色归属变更后，网站会拒绝后续控制请求。有效期内重启桌面插件会复用保存的授权。若希望在 N.E.K.O. 接收游戏内的主人留言，请在插件配置中开启对应开关。

## 官网及游戏服配置

酒狐 `1.0.7.1+qiandengji.3` 在两种模式下都打开 `/maid-connect.html`。网页向当前域名的签发端查询方式，然后显示临时邀请或跳转至本人女仆授权页。为同一域名的整个 `/api/v1/maid-connect` 前缀配置同一个签发端，确保申请、确认和查询对应同一份记录。若同时提供两种模式，请使用两个 HTTPS 域名，并让桌面的 `portal_origin` 指向对应域名。[临时邀请配置](../neko-trial/README.md)

官网复用原 `/api/v1/sessions`、浏览器会话、同源与 CSRF 检查。从网站已有的游戏角色归属中按原 UUID 匹配女仆主人。管理员凭据也需要对应的角色归属。桌面插件在本机生成设备凭据，官网 SQLite 保存其散列，网站表单只接收登录资料和六位确认码。官网只把批准的主人 UUID、女仆 UUID、到期时间和固定身体 API 地址返回给持有该设备凭据的客户端。

1. 给已启用原生身体端口的私人女仆准备 HTTPS 身体 API。反代继续将 `/api/v1/maid-body` 交给游戏侧的转发服务。若官网与游戏服务分别部署，转发服务只需通过 HTTPS 向官网出站检查授权。两侧的内网 Java 接线见 [HTTPS 接入](API.md)。
2. 网站 `config.local.json` 启用如下配置。绑定来自游戏侧 `native-body-port.json` 的主人和女仆 UUID。显示名称可直接使用游戏内名称。下例的域名及 UUID 均为示例。

   ```json
   {
     "maidConnections": {
       "enabled": true,
       "bodyEndpoint": "https://maid.example.org/api/v1/maid-body",
       "bindings": [
         {
           "ownerId": "11111111-1111-3111-8111-111111111111",
           "maidId": "10000000-0000-0000-0000-000000000011",
           "name": "禾穗"
         }
       ]
     }
   }
   ```

3. 游戏侧 `maid-api.mjs` 的私有配置加入 `portalOrigin` 和 `publicEndpoint`。`publicEndpoint` 应与官网的 `bodyEndpoint` 相同。启用官网授权时可省略手动发放使用的 `grantsFile`。

   ```json
   {
     "schema": 1,
     "port": 19088,
     "nativePort": 19087,
     "nativeTokenFile": "D:/private/maid-native.key",
     "portalOrigin": "https://mc.kangqiang.site",
     "publicEndpoint": "https://maid.example.org/api/v1/maid-body"
   }
   ```

4. 正常发布官网和游戏侧转发服务。在官网明确设置受信 HTTPS 代理和 `publicOrigin`。在 TLS 反代对女仆路由使用 `proxy_read_timeout 15s`，覆盖官网检查与原生动作的等待时间。访问日志可记录路径和状态码，授权头、会话 Cookie 和登录正文留在请求处理链路内。 [Nginx 反代模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

女仆 API 收到设备凭据后先请求官网核验授权，然后调用本机原生端口。已持有租约时，转发服务定期复核授权，收到撤销后释放所持有的租约并停止其在途寻路。官网暂时不可达时，新的调用返回不可用，原生端口按现有动作超时和租约清理规则处理在途控制。

## 回退与验证

新入口由 `maidConnections.enabled` 控制。关闭后，官网会停止接受设备授权，游戏侧会收回已知的官网授权租约。手动模式仍可使用其独立的游戏侧配置。网站的新增表以现有账号和会话为外键，公开页面加载现有网站登录接口。

门户回归命令为 `node --test tests/maid-connections.test.mjs`。桌面联测可通过私有配置中的 `portal_origin` 和 `ca_file` 指向隔离 HTTPS 门户和测试 CA。游戏侧可在隔离配置中设置 `portalCaFile`。正式站点使用可信域名证书。
