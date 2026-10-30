"""Replace only the marked client-download section; preserve current site features."""
from pathlib import Path
import argparse,html,json,re

START='<!-- QD_MAID_CLIENT_START -->'
END='<!-- QD_MAID_CLIENT_END -->'
def section(release):
    rows=release['artifacts'];pack=next(r for r in rows if r['filename'].endswith('.mrpack'));manual=next(r for r in rows if r['filename'].endswith('.zip'))
    for r in [pack,manual]:
        assert r['url'].startswith('https://qiandengji-downloads-hk-20261023.oss-cn-hongkong.aliyuncs.com/releases/'+r['sha256']+'/') and re.fullmatch('[a-f0-9]{64}',r['sha256'])
    def card(r,title,description,label,link):
        return f'''<article class="panel content-pad"><h3>{title}</h3><p>{description}</p><a class="btn primary" href="{link}" download>{label}</a><details class="gap-top"><summary>SHA256 校验</summary><p class="tiny key-wrap"><code>{r['sha256']}</code></p></details></article>'''
    return f'''{START}
<section id="maid-client" class="panel content-pad" aria-labelledby="maid-client-title">
<p class="eyebrow">Java 游戏客户端 · 可选扩展 · 2026-10-30</p><h2 id="maid-client-title">车万女仆：原生模型与交互</h2>
<p>Minecraft <strong>1.21.1</strong> · Java <strong>21</strong> · NeoForge <strong>21.1.248</strong> · 女仆 <strong>1.5.3</strong>。使用已验证的官方原始客户端，下载由 OSS 直接提供，无需登录网站。</p>
<p><strong>原版 Java、现有 Fabric、Mineflayer 和基岩版仍可进服。</strong>想显示完整原生女仆模型和原界面，再建立这个独立 NeoForge 实例。Agent 的 NEKO、Cortico、DSH 接入工具仍在下方。</p>
<div class="client-grid">{card(pack,'启动器导入包','约 12 KB；启动器按清单直接从 OSS 下载女仆模组，并安装配套 NeoForge。','下载 .mrpack · 推荐','/downloads/maid-client')}{card(manual,'手动安装模组包','约 30.3 MB；包含官方女仆 JAR、NeoForge 安装器、安装说明、许可与校验值。','下载模组 ZIP','/downloads/maid-mods')}</div>
<details class="gap-top"><summary>安装和使用：三步开始</summary><ol><li>使用支持 Modrinth 格式的启动器导入 .mrpack，选择 Java 21；或新建 Minecraft 1.21.1 + NeoForge 21.1.248 实例。</li><li>手动安装时，将 ZIP 的 mods 目录内 JAR 放入该实例的 mods；loader 内的是安装器，不能放进 mods。保留现有 Fabric 实例，避免混装两个加载器的模组。</li><li>连接 <code>micro.kangqiang.site:25702</code>，用原角色与游戏密码登录；与自己的女仆交互。Agent 可查询 <code>/qdmaid help</code>，操作按主人权限执行，无需 OP。</li></ol><p>女仆原生外观随模组提供；玩家自己的 YSM、Numen、语音为可选功能，另选相应 NeoForge 版本。本包只含游戏客户端资源，不含服务器插件、测试控制器、个人账号、模型 Key 或 Minecraft 游戏本体。</p><p>基岩使用服务器资源映射，不能安装 Java JAR；当前未承诺物理基岩画面、真人听感和完整棋牌规则完全等价。</p></details>
<p class="tiny">模组：TartaricAcid 及原作者，代码 MIT、资源 CC BY-NC-SA 4.0，完整声明随包保留。<a href="https://modrinth.com/mod/touhou-little-maid/version/tXG1TkGx" rel="noopener noreferrer" target="_blank">官方女仆版本</a> · <a href="https://github.com/jcs130/minecraft-ai-friend/tree/main/paper/integrations/touhou-maids" rel="noopener noreferrer" target="_blank">配套说明与打包来源</a></p>
</section>
{END}'''

def patch_page(text,release):
    replacement=section(release)
    if START in text:
        assert text.count(START)==1 and text.count(END)==1
        a=text.index(START);b=text.index(END)+len(END);return text[:a]+replacement+text[b:]
    anchor='<section class="panel content-pad download-skill">';assert text.count(anchor)==1,'Current download-page anchor changed; preserve the current page and review'
    return text.replace(anchor,replacement+'\n'+anchor,1)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--page',type=Path,required=True);p.add_argument('--release',type=Path,default=Path(__file__).with_name('client-release.json'));a=p.parse_args()
    before=a.page.read_text(encoding='utf-8');release=json.loads(a.release.read_text(encoding='utf-8'));after=patch_page(before,release);a.page.write_text(after,encoding='utf-8');print('Updated only the marked optional-client section')
