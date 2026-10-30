"""Apply only this feature to the exact extracted production 0.8.31 baseline.

Existing code, viewers, nine downloads and configuration stay in the live source
tree. No older portal checkout or database is substituted for production.
"""
import argparse,hashlib,json,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parent
assert not a.out.exists();assert json.loads((a.source/'package.json').read_text(encoding='utf-8'))['version']=='0.8.31'
shutil.copytree(a.source,a.out)
changes={}
def edit(name,old,new):
 f=a.out/name;s=f.read_text(encoding='utf-8');assert s.count(old)==1,(name,old[:90]);changes.setdefault(name,hashlib.sha256((a.source/name).read_bytes()).hexdigest());f.write_text(s.replace(old,new),encoding='utf-8',newline='\n')
edit('src/download-catalog.mjs',"import offlineDownloads from './offline-downloads.json' with { type: 'json' };","import offlineDownloads from './offline-downloads.json' with { type: 'json' };\nimport saoClient from './sao-client.json' with { type: 'json' };")
edit('src/download-catalog.mjs','export const packageReleases = Object.freeze([','export const packageReleases = Object.freeze([\n  Object.freeze(saoClient),')
edit('src/server.mjs',"import { publicDialogueText } from './public-dialogue.mjs';","import { publicDialogueText } from './public-dialogue.mjs';\nimport { SharedRealmAccess } from './shared-realm-access.mjs';")
edit('src/server.mjs','  const accounts = new GameAccounts(config, store, game, accountCloud);','  const accounts = new GameAccounts(config, store, game, accountCloud);\n  const sharedRealmAccess = new SharedRealmAccess(config, store, game, cloud);')
edit('src/server.mjs',"const authority = req.method === 'POST' && pathname === '/api/v1/internal/accounts/poll' ? accountCloud","const authority = req.method === 'GET' && pathname === '/api/v1/internal/realm-accounts/roles' ? sharedRealmAccess\n          : req.method === 'POST' && pathname === '/api/v1/internal/accounts/poll' ? accountCloud")
edit('src/server.mjs',"      if (req.method === 'GET' && pathname === '/api/v1/downloads')", "      if (req.method === 'GET' && pathname === '/api/v1/internal/realm-accounts/roles') {\n        sharedRealmAccess.authorize(req); rate('shared-realm-roles', 12, 60000);\n        return respond(res, 200, await sharedRealmAccess.roles(req));\n      }\n      if (req.method === 'GET' && pathname === '/api/v1/downloads')")
edit('src/config.mjs',"  config.downloads.baseUrl = downloadBaseUrl(config.downloads.baseUrl);","  config.downloads.baseUrl = downloadBaseUrl(config.downloads.baseUrl);\n  config.sharedRealmAccess = { enabled: false, realmId: 'sao', tokenHash: '', ...local.sharedRealmAccess, ...overrides.sharedRealmAccess };\n  if (config.sharedRealmAccess.enabled && (config.sharedRealmAccess.realmId !== 'sao' || !/^[a-f0-9]{64}$/.test(config.sharedRealmAccess.tokenHash))) throw new Error('Invalid shared realm authority configuration');")
edit('public/downloads.js',"    document.querySelector('#package-downloads').replaceChildren", "    document.querySelector('#game-client-downloads').replaceChildren(...packages.filter(row => row.category === 'game-client').map(card));\n    document.querySelector('#package-downloads').replaceChildren")
edit('public/downloads.html','<h2>1 · 选择你的宿主包</h2>', '<h2 id="game-clients">真人玩家客户端</h2><p><a href="/sao.html">SAO 安装与共用账号说明</a> · 原版 Java 客户端不能加载全部模组内容，请导入以下整合包。</p><section id="game-client-downloads" class="client-grid" aria-label="真人游戏客户端"></section>\n<h2>1 · 选择你的宿主包</h2>')
edit('public/downloads.html','<h1>插件与接入工具</h1>','<h1>客户端、插件与接入工具</h1>')
edit('public/downloads.html','<title>插件下载 · 千灯纪</title>','<title>客户端下载与接入工具 · 千灯纪</title>')
edit('public/downloads.html','这里提供我们维护的 Minecraft 插件。选择你正在使用的框架，下载配套扩展，再带着自己的角色、模型和记忆进入千灯纪。','这里提供真人客户端整合包与 Agent 接入工具。真人玩家选择 SAO 客户端；Agent 按自己的框架安装扩展，带着自己的角色、模型和记忆进入世界。')
edit('public/downloads.html','公开下载无需登录。先安装插件，再用接入链接在插件中注册与连接；','公开下载无需登录。Agent 接入时先安装插件，再用接入链接在插件中注册与连接；')
edit('public/downloads.html','公共资源保留原有许可；首次使用仍需自己的宿主和可用模型。','公共资源保留原有许可。Agent 工具仍需自己的宿主和可用模型；Java 真人客户端不需要模型 Key。')
edit('public/app.js','<h2 id="upcoming-fom-title">FOM 模组世界</h2><span class="coming-soon-badge">敬请期待</span></div><p>机械工坊、田园生活与新的冒险，正在另一个世界慢慢成形。</p><small>尚未正式开放，开放时间与接入方式将另行公布。</small>', '<h2 id="upcoming-fom-title">SAO 模组世界</h2><span class="coming-soon-badge">公开测试</span></div><p>与玩家和 Agent 一起探索新的世界，沿用千灯纪网站账号与游戏角色。</p><small><a href="/sao.html">客户端下载与登录说明</a> · Java 1.20.1 / Forge 47.4.10</small>')
edit('public/app.js','<div class="upcoming-world-mark" aria-hidden="true">FOM</div>','<div class="upcoming-world-mark" aria-hidden="true">SAO</div>')
for src,dst in [('sao-client.json','src/sao-client.json'),('shared-realm-access.mjs','src/shared-realm-access.mjs'),('sao.html','public/sao.html')]:shutil.copy2(root/src,a.out/dst)
tests=a.out/'tests/download-catalog.test.mjs'
if tests.exists():
 s=tests.read_text(encoding='utf-8')
 for old,new in [(".length !== 9", ".length !== 10"),("querySelectorAll('.download-card').length, 9", "querySelectorAll('.download-card').length, 10"),("querySelectorAll('.download-card a[download]').length, 9", "querySelectorAll('.download-card a[download]').length, 10")]:
  assert s.count(old)==1,old;s=s.replace(old,new)
 anchor="  assert.equal(dom.window.document.querySelectorAll('#package-downloads .download-card').length, 3);"
 assert s.count(anchor)==1;s=s.replace(anchor,"  assert.equal(dom.window.document.querySelectorAll('#game-client-downloads .download-card').length, 1);\n"+anchor)
 tests.write_text(s,encoding='utf-8')
 (a.out/'tests/shared-realm-access.test.mjs').write_text((root/'shared-realm-access.test.mjs').read_text(encoding='utf-8').replace("from './shared-realm-access.mjs'","from '../src/shared-realm-access.mjs'"),encoding='utf-8')
 ui=a.out/'tests/ui.test.mjs';s=ui.read_text(encoding='utf-8')
 s=s.replace("homepage presents FOM as coming soon without any connection action","homepage exposes SAO testing with a client download and shared-account guide")
 old="assert.ok(card);assert.match(card.textContent,/FOM 模组世界/);assert.match(card.textContent,/敬请期待/);assert.match(card.textContent,/尚未正式开放/);"
 assert s.count(old)==1;s=s.replace(old,"assert.ok(card);assert.match(card.textContent,/SAO 模组世界/);assert.match(card.textContent,/公开测试/);assert.match(card.textContent,/千灯纪网站账号/);")
 old="assert.equal(card.querySelectorAll('a,button,input,code').length,0);assert.ok(!card.textContent.includes('28977'));assert.ok(!card.textContent.includes('28976'));"
 assert s.count(old)==1;s=s.replace(old,"assert.equal(card.querySelectorAll('a').length,1);assert.equal(card.querySelector('a').getAttribute('href'),'/sao.html');assert.ok(!card.textContent.includes('28977'));assert.ok(!card.textContent.includes('28976'));")
 ui.write_text(s,encoding='utf-8')
for name in ['package.json','package-lock.json']:
 f=a.out/name;x=json.loads(f.read_text(encoding='utf-8'));x['version']='0.8.32'
 if name=='package-lock.json':x['packages']['']['version']='0.8.32'
 f.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(a.out/'sao-patch-manifest.json').write_text(json.dumps({'sourceVersion':'0.8.31','version':'0.8.32','preimageHashes':changes},indent=2))
print(json.dumps({'version':'0.8.32','changedExistingFiles':list(changes),'newModules':['shared-realm-access.mjs','sao-client.json','sao.html']}))
