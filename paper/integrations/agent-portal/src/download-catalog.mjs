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
  Object.freeze({ id: 'neko-plugin', framework: 'neko', category: 'host', name: 'NEKO 插件文件', version: '0.6.114', channel: 'github-release',
    filename: 'minecraft-autonomous-0.6.114.neko-plugin', bytes: 30047199,
    sha256: 'fb83bbb7272b594d188fa3ee45db79838d968ba98ef7c4baddd95b490f442352',
    sourceUrl: 'https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous/releases/download/v0.6.114/minecraft_autonomous.neko-plugin',
    platform: 'Linux x64 / CPython 3.11；Windows 请使用基础包内的配套插件', license: 'Apache-2.0',
    install: 'N.E.K.O 插件中心选择导入此 .neko-plugin；复用自己的模型槽，已有运行环境可直接配置。',
    includes: '适用于已有运行环境的 Linux 宿主。Windows 可选择 NEKO 完整离线安装包。' }),
];
export const packageReleases = Object.freeze([
  ...residentDownloads.map(row => Object.freeze(row)),
  ...desktopClientDownloads.map(row => Object.freeze(row)),
  ...androidClientDownloads.map(row => Object.freeze(row)),
  ...maidClientDownloads.map(row => Object.freeze(row)),
  Object.freeze(saoClient),
  ...offlineDownloads.map(row => Object.freeze(row)),
  ...originalReleases,
]);

const aliases=Object.freeze({'/downloads/java-client':'desktop-client-pack','/downloads/android-client':'android-client-pack','/downloads/android-native-client':'android-native-client-pack','/downloads/maid-client':'maids-client-pack','/downloads/maid-mods':'maids-client-mods','/downloads/cortico-lite':'cortico-lite','/downloads/cortico':'cortico-world','/downloads/dsh':'dsh-adapter','/downloads/neko':'neko-base','/downloads/audio':'shared-audio','/downloads/browser':'shared-browser'});
const previousResidentPackages = Object.freeze([
  Object.freeze({id:'resident-neko',version:'0.3.1',filename:'qiandengji-resident-0.3.1.neko-plugin',bytes:54858,
    sha256:'eca225e804d3575a8e61ca7c878bb46a3821e96421b255a2c0e5218adb1f2531'}),
  Object.freeze({id:'resident-neko',version:'0.3.2',filename:'qiandengji-resident-0.3.2.neko-plugin',bytes:64040,
    sha256:'809446a1988e8d75fe3bd6e7f537356865c06a51b26d8ccf7ac3c2d1fa502768'}),
  Object.freeze({id:'resident-neko',version:'0.3.4',filename:'qiandengji-resident-0.3.4.neko-plugin',bytes:68171,
    sha256:'8921fa5897988ded677e19b9db55ab19dfdddf7dbd88190b25b7f2b72eb6fb6a'}),
]);
export const packageAt = pathname => packageReleases.find(row =>
  pathname === '/downloads/' + row.filename || aliases[pathname] === row.id)
  ?? previousResidentPackages.find(row => pathname === '/downloads/' + row.filename);
export function publicDownloads(config) {
  return packageReleases.map(release => {
    const available = !!config.downloads?.baseUrl && (config.downloads?.enabledPackages || []).includes(release.id);
    return { ...release, available, url: available ? '/downloads/' + release.filename : null };
  });
}
export function packageLocation(config, release) {
  return (config.downloads?.enabledPackages || []).includes(release.id) ? skillMirrorUrl(config, release) : null;
}
