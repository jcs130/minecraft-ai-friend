// Freeze the tested shared renderer and locked dependencies for a private local deployment.
import {access,cp,mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const [viewerRoot,assetsRoot,outputRoot]=process.argv.slice(2);
if (![viewerRoot,assetsRoot,outputRoot].every(value=>value&&path.isAbsolute(value))) throw Error('Usage: node prepare-photo-camera.mjs <absolute shared viewer repo> <absolute prepared assets> <absolute NEW private runtime root>');
try {await access(outputRoot);throw Error('PHOTO_RUNTIME_ALREADY_EXISTS');} catch(error){if(error.code!=='ENOENT')throw error;}
const dependencyRoot=fileURLToPath(new URL('./photo-camera/',import.meta.url));
const modules=['packages/modern-viewer/src/viewer-stream.mts',...['viewer-photo-page','viewer-page-assets','viewer-content','text-display','viewer-appearance','viewer-ysm-assets'].map(name=>'packages/modern-viewer/renderer-src/host/'+name+'.mjs')];
await Promise.all([...modules.map(name=>access(path.join(viewerRoot,name))),access(path.join(assetsRoot,'dist/modern-viewer.js')),access(path.join(dependencyRoot,'node_modules/puppeteer-core/package.json'))]);
await mkdir(outputRoot);
for(const name of modules){const dest=path.join(outputRoot,name);await mkdir(path.dirname(dest),{recursive:true});await cp(path.join(viewerRoot,name),dest);}
for(const name of ['package.json','package-lock.json','node_modules']) await cp(path.join(dependencyRoot,name),path.join(outputRoot,name),{recursive:true});
await cp(assetsRoot,path.join(outputRoot,'assets'),{recursive:true});
const files={};
async function inventory(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await inventory(file);else if((await lstat(file)).isFile()){const bytes=await readFile(file);files[path.relative(outputRoot,file).replaceAll('\\','/')]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}}}
await inventory(outputRoot);
await writeFile(path.join(outputRoot,'runtime-manifest.json'),JSON.stringify({schema:1,preparedAt:new Date().toISOString(),minecraftVersion:'1.20.6',preset:'qiandengji',files},null,2));
console.log(JSON.stringify({prepared:true,root:outputRoot,files:Object.keys(files).length,bundleSha256:files['assets/dist/modern-viewer.js'].sha256}));
