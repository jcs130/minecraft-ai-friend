import { skillMirrorUrl } from './download-mirror.mjs';
import offlineDownloads from './offline-downloads.json' with { type: 'json' };

// Mirror original published bytes, not the current developer checkout. Large
// binaries stay in OSS; this repository contains only their reviewed manifest.
const originalReleases = [
  Object.freeze({ id: 'cortico-world', framework: 'cortico', name: 'Cortico World', version: '0.4.1-rc.14', channel: 'npm-next',
    filename: 'cortico-world-qiandengji-0.4.1-rc.14.tgz', bytes: 120904,
    sha256: 'c242e6c879c809ee15b010c3bba4783fbad4d2c5404c8f1ce0bc3cf5b55b275e',
    sourceUrl: 'https://registry.npmjs.org/cortico-world-qiandengji/-/cortico-world-qiandengji-0.4.1-rc.14.tgz',
    platform: 'Node.js 22+；Cortico API 6，官方 0.2.5 已验收', license: 'MIT',
    install: '在 Cortico 的 extensions 目录用 pnpm add --ignore-workspace 安装本地 tgz，重启宿主后打开“联机版我的世界”。',
    includes: 'World 扩展；核心和服务器包由 npm 依赖安装，不是完整离线运行环境。' }),
  Object.freeze({ id: 'dsh-adapter', framework: 'dsh', name: 'DSH Minecraft 插件', version: '0.3.0-rc.12', channel: 'npm-latest-candidate',
    filename: 'jcs130-dsh-minecraft-agent-0.3.0-rc.12.tgz', bytes: 77648,
    sha256: '2beb51ba045226cd6802620063964b03fcaecfb405ff781a998803a4ab497184',
    sourceUrl: 'https://registry.npmjs.org/@jcs130/dsh-minecraft-agent/-/dsh-minecraft-agent-0.3.0-rc.12.tgz',
    platform: 'Node.js 24+；官方 DSH 0.2.1-rc.2', license: 'MIT',
    install: '在 DSH 部署目录用 npm install 安装本地 tgz，启用 mc-harness，配置本人的私有角色连接文件。',
    includes: 'DSH 适配器；核心和宿主依赖仍需 npm 安装。rc.13 的邀请接入仍属源码开发版。' }),
  Object.freeze({ id: 'neko-plugin', framework: 'neko', name: 'NEKO 插件文件', version: '0.6.70', channel: 'github-release',
    filename: 'minecraft-autonomous-0.6.70.neko-plugin', bytes: 12655307,
    sha256: '0c3142bea90714db01c7f3dfae8f1ada85798aff86fd066816a5b22678c9b57a',
    sourceUrl: 'https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous/releases/download/v0.6.70/minecraft_autonomous.neko-plugin',
    platform: 'Linux x64 / CPython 3.11；Windows 请使用基础包内的配套插件', license: 'Apache-2.0',
    install: 'N.E.K.O 插件中心选择导入此 .neko-plugin；复用自己的模型槽，已有运行环境可直接配置。',
    includes: '插件本身，不包含全部 Node、观战和游戏资源。首次安装选下面的完整包。' }),
  Object.freeze({ id: 'neko-offline', framework: 'neko', name: 'NEKO 完整离线包', version: '0.6.70', channel: 'github-release',
    filename: 'Minecraft-Autonomous-0.6.70-Windows-x64-offline.zip', bytes: 1111598162,
    sha256: '411116155dbc91af50acd1a50953080227222e3f0cb2332ec273af294c54ffd8',
    sourceUrl: 'https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous/releases/download/v0.6.70/Minecraft-Autonomous-0.6.70-Windows-x64-offline.zip',
    platform: 'Windows x64；N.E.K.O CPython 3.11', license: 'Apache-2.0；保留包内各组件声明',
    install: '完整解压，运行“一键安装.cmd”，再到 N.E.K.O 插件中心导入包内 .neko-plugin。',
    includes: '约 1.11 GB，含 Node、固定后端、依赖和观战资源；仍需自己的 N.E.K.O 与可用模型。' }),
];
export const packageReleases = Object.freeze([
  ...offlineDownloads.map(row => Object.freeze(row)),
  ...originalReleases.map(row => Object.freeze({ ...row, category: 'advanced' })),
]);

export const packageAt = pathname => packageReleases.find(row => pathname === '/downloads/' + row.filename);
export function publicDownloads(config) {
  return packageReleases.map(release => {
    const available = !!config.downloads?.baseUrl && (config.downloads?.enabledPackages || []).includes(release.id);
    return { ...release, available, url: available ? '/downloads/' + release.filename : null };
  });
}
export function packageLocation(config, release) {
  return (config.downloads?.enabledPackages || []).includes(release.id) ? skillMirrorUrl(config, release) : null;
}
