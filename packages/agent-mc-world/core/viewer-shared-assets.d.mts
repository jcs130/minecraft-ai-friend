export function shareViewerAssets(directory:string,options:{generated:boolean}):Promise<{aliases:number;objects:number;removedBytes:number;objectBytes:number;savedBytes:number}>;
export function createSharedViewerAssets(directory:string):{resolve(file:string):Promise<{file:string;bytes:number;sha256:string}|null>};
