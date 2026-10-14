export interface JavaDataViewerHandle { url: string; status(): Record<string,unknown>; close(): Promise<void> }
export function createJavaDataViewer(options: {
  port:number; assetsDir:string; uuid:string; server:string; radius?:number;
  rpc:(method:string,params:Record<string,unknown>)=>Promise<any>;
}): Promise<JavaDataViewerHandle>;
