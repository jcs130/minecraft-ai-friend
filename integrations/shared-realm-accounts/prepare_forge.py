"""Prepare an isolated Forge build; the author modpack and runtime remain untouched."""
import argparse,hashlib,json,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--directauth',type=Path,required=True);p.add_argument('--verified-maven',type=Path,required=True);a=p.parse_args()
assert not a.out.exists();assert hashlib.sha256(a.directauth.read_bytes()).hexdigest()=='196ee293d8dd1a8d207c8deecbb24638b15f8770197bddb04930e5a8a349d9b2'
root=Path(__file__).resolve().parent;a.out.mkdir(parents=True)
for source in ['java','forge']:
 shutil.copytree(root/source,a.out/'src/main/java',dirs_exist_ok=True)
r=a.out/'src/main/resources';(r/'META-INF').mkdir(parents=True)
shutil.copy2(root/'forge-mods.toml',r/'META-INF/mods.toml')
(r/'maw_shared_accounts.mixins.json').write_text(json.dumps({'required':True,'minVersion':'0.8','package':'dev.qiandeng.accounts.mixin','compatibilityLevel':'JAVA_17','mixins':['NoSharedGrace','AccountRegistration','PremiumLookup'],'injectors':{'defaultRequire':1}}))
(a.out/'auth-libs').mkdir();shutil.copy2(a.directauth,a.out/'auth-libs'/a.directauth.name)
shutil.copytree(a.verified_maven,a.out/'verified-maven')
(a.out/'settings.gradle').write_text("pluginManagement { repositories { gradlePluginPortal(); maven { url = 'https://maven.minecraftforge.net/' } } }\nrootProject.name='maw-shared-accounts'\n")
(a.out/'build.gradle').write_text("""plugins { id 'java'; id 'net.minecraftforge.gradle' version '6.0.54' }
group='dev.qiandeng.maw'
version='0.1.1'
java.toolchain.languageVersion=JavaLanguageVersion.of(17)
minecraft { mappings channel:'official', version:'1.20.1' }
repositories { maven { url=uri('verified-maven') }; mavenCentral(); maven { url='https://libraries.minecraft.net/' }; maven { url='https://maven.minecraftforge.net/' } }
dependencies { minecraft 'net.minecraftforge:forge:1.20.1-47.4.10'; compileOnly files(fileTree('auth-libs') { include '*.jar' }) }
tasks.withType(JavaCompile).configureEach { options.encoding='UTF-8'; options.compilerArgs+=['-proc:none'] }
jar { manifest { attributes('MixinConfigs':'maw_shared_accounts.mixins.json') } }
jar.finalizedBy('reobfJar')
""")
print('Prepared isolated Forge shared accounts build')
