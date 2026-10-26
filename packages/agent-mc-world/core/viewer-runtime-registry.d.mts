export const VIEWER_REGISTRY_FIELDS:readonly string[];
export interface ViewerRuntimeRegistry {schemaVersion:1;minecraftVersion:string;data:Record<string,unknown>;protocolVersions:unknown[]}
export function viewerRuntimeRegistry(version:string,require?:(name:string)=>any):Promise<ViewerRuntimeRegistry>;
export function viewerRuntimeScript(registry:ViewerRuntimeRegistry,resources:import('./viewer-version.mjs').ViewerAssetSelection):string;
