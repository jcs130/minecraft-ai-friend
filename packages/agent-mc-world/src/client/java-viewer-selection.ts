import type { JavaClientConfiguration } from '../contracts/java-client.ts';

/** Negotiate only advertised capabilities of the already attached action client.
 * Missing assets, authentication failures and rendering errors are never capability
 * fallbacks: they remain visible errors without changing the game connection. */
export function selectJavaViewer(cfg: Pick<JavaClientConfiguration, 'viewerMode' | 'viewerPageFile'>, capabilities: Record<string, unknown>) {
  if (capabilities.protocol !== 'agent-mc-java/v1') throw new Error('Unsupported native capability protocol');
  const mode = cfg.viewerMode ?? 'auto';
  const data = capabilities.visualData === 'agent-mc-visual/v1' && ['1.20.6','1.21.1'].includes(String(capabilities.minecraftVersion));
  if (mode === 'data' && !data) throw new Error('This client does not advertise supported native world data');
  if (mode !== 'framebuffer' && data) return { mode: 'data' as const, reason: '已识别原生世界数据；打开画面后按需读取' };
  if (!cfg.viewerPageFile || capabilities.realRendering !== true) throw new Error('Native data unavailable; no explicit compatible screenshot page configured');
  return { mode: 'framebuffer' as const, reason: mode === 'auto'
    ? '此客户端尚不支持三维数据画面，当前为原生截图兼容预览'
    : '原生截图预览（显式配置）' };
}
