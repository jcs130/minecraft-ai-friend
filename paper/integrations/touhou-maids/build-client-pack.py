"""Build public client-only packs from two reviewed, unmodified upstream files."""
from pathlib import Path
import argparse,hashlib,json,shutil,urllib.parse,zipfile

MOD_NAME='touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'
MOD_SHA='f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27'
LOADER_NAME='neoforge-21.1.248-installer.jar'
LOADER_SHA='68eeab77059ba53df1812f1afa5bf530ab2566a3cdcd5f924aa6e71be42e410c'
VERSION='1.0.0-20261030'
UPSTREAM='https://modrinth.com/mod/touhou-little-maid/version/tXG1TkGx'

def digest(data,algorithm='sha256'):return hashlib.new(algorithm,data).hexdigest()
def encoded(value):return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode('utf-8')
def archive(path,files):
    assert not path.exists(),'Immutable output already exists'
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as out:
        for name,data in sorted(files.items()):
            assert not name.startswith('/') and '..' not in Path(name).parts
            info=zipfile.ZipInfo(name,date_time=(2026,10,30,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;out.writestr(info,data)

def build(mod,loader,licenses,output,base):
    url=urllib.parse.urlsplit(base)
    assert url.scheme=='https' and url.netloc and not url.username and not url.password and not url.query and not url.fragment
    assert not any(x in base for x in ['%','\\','..'])
    base=base.rstrip('/')+'/'
    mod_bytes=mod.read_bytes();loader_bytes=loader.read_bytes()
    assert digest(mod_bytes)==MOD_SHA,'Use the reviewed original client mod, never the modified server JAR'
    assert digest(loader_bytes)==LOADER_SHA,'NeoForge installer changed'
    output.mkdir(parents=True,exist_ok=True)
    credits={name:(licenses/name).read_bytes() for name in ['LICENSE.upstream.txt','LICENSE.TLM-assets.txt','LICENSE.TLM-voices.txt']}
    mod_public='touhoulittlemaid-1.5.3-neoforge-mc1.21.1.jar'
    mod_url=base+MOD_SHA+'/'+mod_public
    loader_url=base+LOADER_SHA+'/'+LOADER_NAME
    manifest={'schema':1,'version':VERSION,'minecraft':'1.21.1','java':21,'loader':{'id':'neoforge','version':'21.1.248','installerSha256':LOADER_SHA,'url':loader_url},
      'mod':{'id':'touhou_little_maid','version':'1.5.3-neoforge+mc1.21.1','filename':MOD_NAME,'sha256':MOD_SHA,'sha512':digest(mod_bytes,'sha512'),'sha1':digest(mod_bytes,'sha1'),'bytes':len(mod_bytes),'url':mod_url,'source':UPSTREAM,'modified':False},
      'optionalClient':True,'vanillaJavaRequiredMods':[],'bedrockRequiredMods':[],
      'serverAddress':'micro.kangqiang.site:25702','website':'https://mc.kangqiang.site',
      'includesMinecraftOrAccounts':False,'privateProfilesIncluded':False,
      'limitations':['Fabric实例不能加载NeoForge模组；使用独立实例。','玩家YSM和Numen为可选功能，另选对应NeoForge版本；本包不含Fabric JAR。','基岩模型由服务器资源映射提供，不能安装Java JAR。','实际耳听、物理基岩画面和完整棋局仍未验收。']}
    readme=f'''# 千灯纪 · 原生女仆客户端 {VERSION}

这是可选客户端扩展。原版 Java、Fabric、Mineflayer 和基岩版仍可进服，无需因此更换现有角色或密码。

## 安装

推荐：在支持 Modrinth 的 HMCL / PCL / Prism 等启动器中导入同版本 .mrpack，使用 Java 21。
手动：新建 Minecraft 1.21.1 + NeoForge 21.1.248 实例，将本包 mods/{MOD_NAME} 放进该实例的 mods 目录。
loader/{LOADER_NAME} 是 NeoForge 安装器，不是模组，不要放进 mods。启动器已装相同 NeoForge 时不用运行它。
已有 Fabric 实例请保留；不要把 NeoForge JAR 与 Fabric API、Fabric版YSM或Fabric版Numen混装。

连接 micro.kangqiang.site:25702。账号、游戏密码及模型凭据由本人管理；本包不包含任何人的账号、Key、游戏存档或完整 Minecraft。

## 使用

完整原生女仆模型、原版女仆交互和界面需要这个 NeoForge 客户端。原版 Java / Mineflayer 使用服务器提供的兼容投影与操作接口。
进服后先按实际游戏指引，与本人拥有的女仆交互；Agent 可用 /qdmaid help 查询当前操作与主人限制，无需 OP。
女仆的模型由原模组自带；玩家自己的 YSM、Numen、语音模组都是可选，需另用对应 NeoForge 版本。
本包不包含测试控制器、调试用客户端模组、服务端插件或服务端改版女仆。

常用控制、背包与实际作业已有独立验收；棋牌当前只验证入座，完整棋局、物理基岩画面及真人听感仍待验证。

## 来源与许可

Touhou Little Maid：TartaricAcid 及原作者，{UPSTREAM}
源代码：https://github.com/TartaricAcid/TouhouLittleMaid
代码 MIT，模型/美术等资源 CC BY-NC-SA 4.0，音频按随包许可；完整声明在 LICENSES/。本包保留官方客户端原始字节。
NeoForge： https://neoforged.net/ ，原安装器来自官方 Maven，保留其内置许可。
千灯纪打包说明与脚本：https://github.com/jcs130/minecraft-ai-friend/tree/main/paper/integrations/touhou-maids
所有 SHA256 均列于 manifest.json / SHA256SUMS.txt。资源来自固定版本，公开下载不需要网站密码或模型 Key。
'''.encode('utf-8')
    modrinth={'formatVersion':1,'game':'minecraft','versionId':VERSION,'name':'千灯纪 · 原生女仆（可选）','summary':'Minecraft 1.21.1 / NeoForge 21.1.248，官方原始女仆1.5.3；原版与基岩仍可直接入服。',
      'dependencies':{'minecraft':'1.21.1','neoforge':'21.1.248'},'files':[{'path':'mods/'+MOD_NAME,'hashes':{'sha1':digest(mod_bytes,'sha1'),'sha512':digest(mod_bytes,'sha512')},'env':{'client':'required','server':'unsupported'},'downloads':[mod_url],'fileSize':len(mod_bytes)}]}
    manual={'README.zh-CN.md':readme,'manifest.json':encoded(manifest),'mods/'+MOD_NAME:mod_bytes,'loader/'+LOADER_NAME:loader_bytes}
    for name,data in credits.items():manual['LICENSES/'+name]=data
    manual['SHA256SUMS.txt']=''.join(digest(data)+'  '+name+'\n' for name,data in sorted(manual.items())).encode()
    archive(output/'qiandengji-maids-1.21.1-neoforge-20261030.zip',manual)
    imported={'modrinth.index.json':encoded(modrinth),'overrides/README-Qiandengji.md':readme,'overrides/qiandengji-client-manifest.json':encoded(manifest)}
    for name,data in credits.items():imported['overrides/LICENSES/'+name]=data
    archive(output/'qiandengji-maids-1.21.1-neoforge-20261030.mrpack',imported)
    for name,data in [(mod_public,mod_bytes),(LOADER_NAME,loader_bytes)]:
        p=output/name;assert not p.exists();p.write_bytes(data)
    artifacts=[]
    for p in sorted(output.iterdir()):
        if p.is_file():artifacts.append({'filename':p.name,'bytes':p.stat().st_size,'sha256':digest(p.read_bytes()),'url':base+digest(p.read_bytes())+'/'+p.name})
    report={'schema':1,'version':VERSION,'artifacts':artifacts,'client':manifest}
    (output/'release.json').write_bytes(encoded(report))
    # Verify actual packaged files and launcher-selected loader, not filenames.
    with zipfile.ZipFile(output/'qiandengji-maids-1.21.1-neoforge-20261030.zip') as z:
        assert digest(z.read('mods/'+MOD_NAME))==MOD_SHA and digest(z.read('loader/'+LOADER_NAME))==LOADER_SHA
        assert set(z.namelist())==set(manual)
    with zipfile.ZipFile(output/'qiandengji-maids-1.21.1-neoforge-20261030.mrpack') as z:
        d=json.loads(z.read('modrinth.index.json'));assert d['dependencies']=={'minecraft':'1.21.1','neoforge':'21.1.248'};assert d['files'][0]['downloads']==[mod_url];assert d['files'][0]['hashes']['sha512']==digest(mod_bytes,'sha512')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--maid-jar',type=Path,required=True);p.add_argument('--neoforge-installer',type=Path,required=True);p.add_argument('--licenses',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--base-url',required=True);a=p.parse_args()
    result=build(a.maid_jar,a.neoforge_installer,a.licenses,a.output,a.base_url)
    print(json.dumps({'version':result['version'],'artifacts':result['artifacts'],'verifiedOriginalMod':True},ensure_ascii=False))
