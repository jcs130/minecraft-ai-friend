import { skillMirrorUrl } from './download-mirror.mjs';
import saoClient from './sao-client.json' with { type: 'json' };
import offlineDownloads from './offline-downloads.json' with { type: 'json' };
import maidClientDownloads from './maid-client-downloads.json' with { type: 'json' };
import androidClientDownloads from './android-client-downloads.json' with { type: 'json' };
import desktopClientDownloads from './desktop-client-downloads.json' with { type: 'json' };
import residentDownloads from './resident-downloads.json' with { type: 'json' };

// Mirror original published bytes, not the current developer checkout. Large
// binaries stay in OSS; this repository contains only their reviewed manifest.
const originalReleases = [
  Object.freeze({ id: 'cortico-world', framework: 'cortico', category: 'host', name: 'Cortico World 联网版', version: '0.4.1-rc.70', channel: 'npm-next',
    filename: 'cortico-world-qiandengji-0.4.1-rc.70.tgz', bytes: 165664,
    sha256: 'd82e41e654471780c9cda30cb96a76dd610ff5232c28b9c325625d34db9b6de9',
    sourceUrl: 'https://registry.npmjs.org/cortico-world-qiandengji/-/cortico-world-qiandengji-0.4.1-rc.70.tgz',
    platform: 'Node.js 22+；支持 World API 6 的 Cortico 0.2.x', license: 'MIT',
    install: '在 Cortico 的 extensions 目录用 pnpm add --ignore-workspace 安装本地 tgz，重启宿主后打开“联机版我的世界”。',
    includes: 'npm next 已发布的 World 扩展。首次安装联网获取兼容的核心和千灯纪资料包。' }),
  Object.freeze({ id: 'dsh-adapter', framework: 'dsh', category: 'host', name: 'DSH Minecraft 插件联网版', version: '0.3.0-rc.26', channel: 'npm-latest-candidate',
    filename: 'dsh-minecraft-agent-0.3.0-rc.26.tgz', bytes: 1142503,
    sha256: 'b8babea51e6373ba67d8c337a756e8eb5cd01457cc8014178e203cfdbb2e91ad',
    sourceUrl: 'https://registry.npmjs.org/@jcs130/dsh-minecraft-agent/-/dsh-minecraft-agent-0.3.0-rc.26.tgz',
    platform: 'Node.js 24+；官方 DSH 0.2.1-rc.2', license: 'MIT',
    install: '在 DSH 部署目录联网安装本地 tgz，启用 mc-harness，沿用自己的角色连接配置。',
    includes: 'npm latest 已发布的适配器，内置依赖声明锁定 MC 核心 rc.153。' }),
  Object.freeze({ id: 'neko-plugin', framework: 'neko', name: 'NEKO 插件文件', version: '0.6.114', channel: 'github-release',
    filename: 'minecraft-autonomous-0.6.114.neko-plugin', bytes: 30047199,
    sha256: 'fb83bbb7272b594d188fa3ee45db79838d968ba98ef7c4baddd95b490f442352',
    sourceUrl: 'https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous/releases/download/v0.6.114/minecraft_autonomous.neko-plugin',
    platform: 'Linux x64 / CPython 3.11；Windows 请使用基础包内的配套插件', license: 'Apache-2.0',
    install: 'N.E.K.O 插件中心选择导入此 .neko-plugin；复用自己的模型槽，已有运行环境可直接配置。',
    includes: '插件本身，不包含全部 Node、观战和游戏资源。首次安装选下面的完整包。' }),
  Object.freeze({ id: 'neko-offline', framework: 'neko', name: 'NEKO 历史离线包', version: '0.6.70', channel: 'github-release',
    filename: 'Minecraft-Autonomous-0.6.70-Windows-x64-offline.zip', bytes: 1111598162,
    sha256: '411116155dbc91af50acd1a50953080227222e3f0cb2332ec273af294c54ffd8',
    sourceUrl: 'https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous/releases/download/v0.6.70/Minecraft-Autonomous-0.6.70-Windows-x64-offline.zip',
    platform: 'Windows x64；N.E.K.O CPython 3.11', license: 'Apache-2.0；保留包内各组件声明',
    install: '完整解压，运行“一键安装.cmd”，再到 N.E.K.O 插件中心导入包内 .neko-plugin。',
    includes: '约 1.11 GB，含 Node、固定后端、依赖和观战资源；仍需自己的 N.E.K.O 与可用模型。' }),
];
export const packageReleases = Object.freeze([
  ...residentDownloads.map(row => Object.freeze(row)),
  ...desktopClientDownloads.map(row => Object.freeze(row)),
  ...androidClientDownloads.map(row => Object.freeze(row)),
  ...maidClientDownloads.map(row => Object.freeze(row)),
  Object.freeze(saoClient),
  ...offlineDownloads.map(row => Object.freeze(row)),
  ...originalReleases.map(row => Object.freeze({ category: 'advanced', ...row })),
]);

const aliases=Object.freeze({'/downloads/java-client':'desktop-client-pack','/downloads/android-client':'android-client-pack','/downloads/android-native-client':'android-native-client-pack','/downloads/maid-client':'maids-client-pack','/downloads/maid-mods':'maids-client-mods','/downloads/cortico-lite':'cortico-lite','/downloads/cortico':'cortico-bundle','/downloads/dsh':'dsh-bundle','/downloads/neko':'neko-base','/downloads/audio':'shared-audio','/downloads/browser':'shared-browser'});
// Existing bookmarks keep their immutable bytes; the recommended alias selects
// the current reviewed complete package. Both use the same operator enablement.
const legacyNekoBase = Object.freeze({id:'neko-base', filename:'qiandengji-neko-0.6.70-base-with-viewer-data.zip',
  bytes:321124552, sha256:'701716c351f8cd3dd43b0837b34131b793648eab740e60d4145748fea59e2dc2'});
const legacyNeko109 = Object.freeze({"id":"neko-base","filename":"NEKO-MC-0.6.109-Windows.zip","sha256":"624ef18e011ef6681cfa1c2e963745e815582130a77b812e0fc525e2fcd4e5d4","bytes":1107341175});
const legacyFclNative = Object.freeze({id:'android-native-client-pack', filename:'qiandengji-android-1.21.1-neoforge-1.0.0-preview.3.mrpack',
  bytes:55283, sha256:'76e8f1f05fa11b28100711be2c23d4bd28b0794a6d6ea48006a7bfaee9c9e1ba'});
const previousFclNative = Object.freeze({id:'android-native-client-pack', filename:'qiandengji-android-1.21.1-neoforge-1.0.0-preview.4.mrpack',
  bytes:88314, sha256:'ccf0f717a2385c9731222fd78553c8a0ea758117ba288f224e2ebf021dc6599c'});
const previousFclTouch = Object.freeze({id:'android-client-pack', filename:'qiandengji-android-1.21.1-neoforge-1.0.0-preview.1.mrpack',
  bytes:52587, sha256:'0da4f0207be0a9ebdb5935da64493e0c14df5798697474087eab102412b70220'});
const legacyDesktopPack = Object.freeze({id:'desktop-client-pack', filename:'qiandengji-java-1.21.1-neoforge-1.1.0.mrpack',
  bytes:8825, sha256:'1ba659e68a2f980fd9a2ac5151405af2ffc78b449d1ed0639e8cacc5eabd70d3'});
const legacyDownloads = Object.freeze([
  Object.freeze({id:'desktop-client-pack', filename:'qiandengji-java-1.21.1-neoforge-1.1.1.mrpack',
    bytes:29442, sha256:'33042290ac2efac1a4ef10e7692f60c2c50e87fad48b708cf4ec1f737fb1a21a'}),
  Object.freeze({id:'android-native-client-pack', filename:'qiandengji-android-1.21.1-neoforge-1.0.0-preview.5.mrpack',
    bytes:110237, sha256:'777b596169f422969558d7e7f83f5a3dbc896690f1a1ebe915e21cdd2e7a8e0c'}),
  Object.freeze({id:'android-client-pack', filename:'qiandengji-android-1.21.1-neoforge-1.0.0-preview.5-touch.mrpack',
    bytes:74522, sha256:'8d8d8b143fe800eeb79f13073de5c24fc1f2e08ce5b48d1e1d3c78b05e4c8389'}),
  Object.freeze({id:'cortico-world', filename:'cortico-world-qiandengji-0.4.1-rc.14.tgz',
    bytes:120904, sha256:'c242e6c879c809ee15b010c3bba4783fbad4d2c5404c8f1ce0bc3cf5b55b275e'}),
  Object.freeze({id:'dsh-adapter', filename:'jcs130-dsh-minecraft-agent-0.3.0-rc.24.tgz',
    bytes:1067944, sha256:'209618e2693d9707dbfb0ca6f23f370d7e2250a9eca1a4c786c7ed8880219c03'}),
]);
export const packageAt = pathname => packageReleases.find(row => pathname === '/downloads/' + row.filename || aliases[pathname]===row.id)
  || legacyDownloads.find(row => pathname === '/downloads/' + row.filename)
  || (pathname === '/downloads/' + legacyDesktopPack.filename ? legacyDesktopPack : undefined)
  || (pathname === '/downloads/' + legacyFclNative.filename ? legacyFclNative : undefined)
  || (pathname === '/downloads/' + previousFclNative.filename ? previousFclNative : undefined)
  || (pathname === '/downloads/' + previousFclTouch.filename ? previousFclTouch : undefined)
  || (pathname === '/downloads/' + legacyNekoBase.filename ? legacyNekoBase : undefined)
  || (pathname === '/downloads/' + legacyNeko109.filename ? legacyNeko109 : undefined)
  || (pathname === '/downloads/jcs130-dsh-minecraft-agent-0.3.0-rc.12.tgz' ? {id:'dsh-adapter',filename:'jcs130-dsh-minecraft-agent-0.3.0-rc.12.tgz',bytes:77648,sha256:'2beb51ba045226cd6802620063964b03fcaecfb405ff781a998803a4ab497184'} : undefined)
  || (pathname === '/downloads/minecraft-autonomous-0.6.70.neko-plugin' ? {id:'neko-plugin',filename:'minecraft-autonomous-0.6.70.neko-plugin',bytes:12655307,sha256:'0c3142bea90714db01c7f3dfae8f1ada85798aff86fd066816a5b22678c9b57a'} : undefined);
export function publicDownloads(config) {
  return packageReleases.map(release => {
    const available = !!config.downloads?.baseUrl && (config.downloads?.enabledPackages || []).includes(release.id);
    return { ...release, available, url: available ? '/downloads/' + release.filename : null };
  });
}
export function packageLocation(config, release) {
  return (config.downloads?.enabledPackages || []).includes(release.id) ? skillMirrorUrl(config, release) : null;
}
