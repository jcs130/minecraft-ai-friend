# AGENTS.md — B 仓(minecraft-ai-friend)工程纪律

## 功能上线三件套(Definition of Done,2026-08-29 立)

> 背景:守卫桥暴死三天、背包卡被顶出视口、numen craft 坏、成就通道挂空目录——
> 全部是造物主使用时撞见,无一主动发现。功能「写完」不等于「完成」。

一个功能只有配齐三样才算上线:

1. **健康探针**:在 `ops/health/health_mon.py` 的 manifest 里加探针
   (HTTP/进程/容器/文件新鲜度/协议应答任一适用形式);
2. **看门狗**:常驻进程必须被某种守护覆盖(schtasks 幂等拉活 / 容器 restart 策略 /
   health_mon --auto 恢复动作),不允许裸进程;
3. **冒烟断言**:改动的用户可见行为(UI 页面、API 应答)在 `health_mon.py` 的
   `probe_panel_smoke` 模式下有断言,改完跑一遍绿了才算完。

改 UI/面板:跑 `python ops/health/health_mon.py` 看 panel-smoke。
新常驻进程:登记到 CONTAINERS 或进程探针。

## 已固化的工程铁律(踩坑沉淀,详录 LESSONS.md)

- cmd.exe 内联多行 python(heredoc/`python -c` 带中文与引号)= 转义黑洞,一律落 .py 文件再跑。
- Windows GBK stdout 下的中文比对会假阴性:比对落文件,`io.open(utf-8)`。
- bind-mount 只读挂载的服务(web-panel.mjs / bootstrap-world.mts):改 B 仓源码后须重启对应容器才生效。
- 镜像 COPY 的资产(资产/worker/bundle):Dockerfile 必须显式 COPY,重建镜像会丢「只活在旧镜像层」的文件。
- RCON 探针/脚本:Source RCON 响应包按 request-id 匹配读取,双读会卡到超时假红。
- 页签/满高不滚布局里,卡片顺序=可见性:后加的卡必须显式排位并加冒烟断言。
