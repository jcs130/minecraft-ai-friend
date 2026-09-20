"""安装 QwenPaw 的 PawApp（控制台里的"页面"）。

分工：`evolution_policy.py` 生成"自我改进看板"（它的数据是动态的，跟着政策与看板走）；
本脚本安装**静态**的 PawApp —— 目前是「天神之眼」：把宿主 127.0.0.1:19092 的
modern-viewer 世界观察画面嵌进控制台，省得在两个口之间来回切。

生成官方插件包后，运行中的 QwenPaw 需用原生插件安装 API 热加载；
已有前端入口的静态更新可由浏览器重新加载。建目录不代表运行时已加载。
"""

import argparse
import json
from pathlib import Path

from pawapp_bridge import (build_frontend, build_manifest, build_static_backend,
                          install_pawapp)

PLUGINS = Path('/state/work/plugins')

GODS_EYE_UI = build_frontend('gods-eye', '天神之眼', '👁', priority=42)
GODS_EYE_PLUGIN = build_manifest(
    'gods-eye', '天神之眼',
    '世界观察渲染：本机 127.0.0.1:19092 的 modern-viewer 画面（Goddess 观察者视角）嵌在这里。',
    '👁', backend=True)
GODS_EYE_BACKEND = build_static_backend('gods-eye', '天神之眼')

GODS_EYE_PAGE = """<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>天神之眼 · 世界观察</title>
<style>
 :root{--bg:#0b0d11;--bar:#141821;--line:#242a36;--txt:#e8eaf0;--dim:#8c93a5;--acc:#6aa9ff;--ok:#3fbf7f;--bad:#e5605e}
 *{box-sizing:border-box}
 html,body{height:100%;margin:0}
 body{background:var(--bg);color:var(--txt);display:flex;flex-direction:column;
      font:13px/1.5 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
 .bar{display:flex;align-items:center;gap:12px;padding:9px 14px;background:var(--bar);
      border-bottom:1px solid var(--line)}
 .dot{width:8px;height:8px;border-radius:50%;background:#555;flex:0 0 auto}
 .dot.up{background:var(--ok)} .dot.down{background:var(--bad)}
 h1{font-size:14px;margin:0;font-weight:600;white-space:nowrap}
 .meta{color:var(--dim);font-size:12px}
 a{color:var(--acc);text-decoration:none;font-size:12px;margin-left:auto;white-space:nowrap}
 iframe{border:0;flex:1;width:100%;background:#000}
 .note{color:var(--dim);font-size:12px;padding:6px 14px;border-top:1px solid var(--line)}
 code{color:var(--acc)}
</style>
</head>
<body>
<div class="bar">
  <span class="dot" id="dot"></span>
  <h1>👁 天神之眼</h1>
  <span class="meta" id="state">正在载入观察页面…</span>
  <a href="http://127.0.0.1:19092/" target="_blank" rel="noopener">新窗口打开 ↗</a>
</div>
<iframe id="eye" src="http://127.0.0.1:19092/" referrerpolicy="no-referrer"
        allow="fullscreen"></iframe>
<div class="note">世界观察渲染来自 <code>127.0.0.1:19092</code>（world 服务的 modern-viewer，Goddess 观察者视角，垂直 FOV 110°）。
本页能嵌它，是因为 19092 的 <code>frame-ancestors</code> 已按配置放行控制台 origin（<code>MC_CONSOLE_ORIGIN</code>，默认 18089）。</div>
<script>
const el = document.getElementById('eye'), dot = document.getElementById('dot'), state = document.getElementById('state');
el.addEventListener('load', () => { dot.className = 'dot up'; state.textContent = '页面已载入，画面状态以观察器为准'; });
el.addEventListener('error', () => { dot.className = 'dot down'; state.textContent = '嵌入被拒 —— 用右上角新窗口'; });
setTimeout(() => { if (!dot.className.includes('up')) { dot.className = 'dot down';
  state.textContent = '观察页面仍在载入，可用新窗口查看'; } }, 3000);
</script>
</body>
</html>
"""


def install(app_id, manifest, page):
    return install_pawapp(PLUGINS / app_id, manifest, page,
                         backend_source=GODS_EYE_BACKEND, priority=42)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', default='gods-eye', choices=['gods-eye'])
    args = parser.parse_args()
    print(json.dumps(install('gods-eye', GODS_EYE_PLUGIN, GODS_EYE_PAGE), ensure_ascii=False))


if __name__ == '__main__':
    main()
