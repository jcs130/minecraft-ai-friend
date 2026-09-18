"""安装 QwenPaw 的 PawApp（控制台里的"页面"）。

分工：`evolution_policy.py` 生成"自我改进看板"（它的数据是动态的，跟着政策与看板走）；
本脚本安装**静态**的 PawApp —— 目前是「天神之眼」：把宿主 127.0.0.1:19092 的
modern-viewer 世界观察画面嵌进控制台，省得在两个口之间来回切。

控制台按请求实时扫描 plugins 目录，所以装完即生效、不需要重启。
"""

import argparse
import json
from pathlib import Path

PLUGINS = Path('/state/work/plugins')

GODS_EYE_PLUGIN = {
    'id': 'gods-eye',
    'name': '天神之眼',
    'version': '1.0.0',
    'description': '世界观察渲染：本机 127.0.0.1:19092 的 modern-viewer 画面（Goddess 观察者视角）嵌在这里。',
    'type': 'app',
    'meta': {'pawapp': {'category': 'monitor', 'icon': '👁',
                        'entry_page': 'index.html', 'launch_scope': 'global'},
             'settings': []},
}

GODS_EYE_PAGE = """<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>天神之眼 · 世界观察</title>
<style>
 :root{--bg:#0b0d11;--card:#151922;--line:#242a36;--txt:#e8eaf0;--dim:#8c93a5;--acc:#6aa9ff}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--txt);
      font:14px/1.6 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
 .wrap{max-width:760px;margin:0 auto;padding:38px 22px 60px}
 h1{font-size:20px;margin:0 0 6px;font-weight:600}
 .sub{color:var(--dim);font-size:13px;margin-bottom:26px}
 .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:16px}
 .big{display:inline-block;margin-top:14px;background:var(--acc);color:#08101f;font-weight:600;
      padding:11px 20px;border-radius:10px;text-decoration:none;font-size:14px}
 .big:hover{filter:brightness(1.08)}
 .row{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
 .row:last-child{border-bottom:0}
 .row span:first-child{color:var(--dim)}
 code{color:var(--acc);font-size:12.5px}
 .why{font-size:12.5px;color:var(--dim)}
 .why b{color:var(--txt);font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <h1>👁 天神之眼 · 世界观察</h1>
  <div class="sub">世界观察渲染（world 服务的 modern-viewer，Goddess 观察者视角，垂直 FOV 110°）</div>

  <div class="card">
    <div class="row"><span>地址</span><span><code>http://127.0.0.1:19092/</code></span></div>
    <div class="row"><span>入口归属</span><span>本机免密码，仅绑定 127.0.0.1</span></div>
    <div class="row"><span>可否内嵌</span><span>否 —— 对方声明 <code>frame-ancestors 'self' http://127.0.0.1:19091</code></span></div>
    <a class="big" href="http://127.0.0.1:19092/" target="_blank" rel="noopener">打开天神之眼 ↗</a>
  </div>

  <div class="card why">
    <b>为什么这里是入口而不是画面本身：</b><br>
    天神之眼的 CSP 里写着 <code>frame-ancestors 'self' http://127.0.0.1:19091</code> ——
    它只允许被它自己和日常首页（19091）嵌入，**不包括本控制台（18089）**。
    这是世界侧有意的边界，不由面板绕过。<br><br>
    若要让画面直接嵌进这里，需要把 <code>18089</code> 加进 19092 的 <code>frame-ancestors</code> ——
    那是一次世界侧的安全边界调整，须经造物主/天神同意后再动。
  </div>
</div>
</body>
</html>
"""


def install(app_id, manifest, page):
    folder = PLUGINS / app_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'plugin.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
    (folder / 'index.html').write_text(page, encoding='utf-8')
    return {'appId': app_id, 'dir': str(folder),
            'entry': '/api/pawapps/%s/static/index.html' % app_id}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', default='gods-eye', choices=['gods-eye'])
    args = parser.parse_args()
    print(json.dumps(install('gods-eye', GODS_EYE_PLUGIN, GODS_EYE_PAGE), ensure_ascii=False))


if __name__ == '__main__':
    main()
