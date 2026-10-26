export const PRIMARY_VIEWER_VERSION: '1.21.1';
export function assertViewerVersion(version: string): string;
export function viewerVersionAssets(root: string, version: string): Promise<string>;
export interface ViewerAssetSelection {directory:string;requestedVersion:string;assetVersion:string;mode:'exact'|'compatible'}
export function selectViewerAssets(root:string,version:string):Promise<ViewerAssetSelection>;
export function viewerVersionRegistry(version: string,
  loadData: (version: string) => { version: { minecraftVersion: string }; biomesArray: Array<{ id: number; name: string }> },
  loadItem: (version: string) => { fromNotch(packet: unknown): unknown }): {
    biomes: Array<{ id: number; name: string }>; plainsBiomeId: number; TradeItem: { fromNotch(packet: unknown): unknown };
  };
export function viewerVersionCss(css: string, version: string): string;
export function viewerVersionTexture(relative: string, version: string): string | null;
