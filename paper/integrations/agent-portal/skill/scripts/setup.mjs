import {existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync} from 'node:fs';
import {dirname, join, resolve, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {parseArgs} from 'node:util';
import {readPlain, readSecret, saveSecret} from './private.mjs';

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function verifyBundle(root = SKILL_ROOT) {
  const file = join(root, 'bundle.json');
  if (!existsSync(file)) throw Error('use_complete_release_zip_with_bundle_and_runtime');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.name !== 'qiandengji-agent' || !Array.isArray(manifest.files)) throw Error('invalid_bundle_manifest');
  const base = realpathSync(root);
  const seen = new Set();
  for (const row of manifest.files) {
    if (typeof row.path !== 'string' || !row.path || seen.has(row.path) || !/^[a-f0-9]{64}$/.test(row.sha256)
      || isAbsolute(row.path) || row.path.split(/[\\/]/).includes('..')) throw Error('invalid_bundle_path');
    seen.add(row.path);
    const target = realpathSync(join(root, row.path));
    if (!target.startsWith(base + (process.platform === 'win32' ? '\\' : '/'))
      || createHash('sha256').update(readFileSync(target)).digest('hex') !== row.sha256) throw Error('bundle_checksum_mismatch');
  }
  return manifest;
}
export function verifyRuntime(root=SKILL_ROOT,manifest=verifyBundle(root)) {
  const file=join(root,'assets/runtime/node_modules/agent-mc-world/package.json');
  let installed;
  try{installed=JSON.parse(readFileSync(file,'utf8'));}
  catch{throw Error('runtime_dependencies_missing_run_npm_ci_in_assets_runtime');}
  if(installed.name!=='agent-mc-world'||installed.version!==manifest.sdk?.version)
    throw Error('installed_core_version_mismatch_run_npm_ci_in_assets_runtime');
  return installed.version;
}
function writeJson(file, data) { writeFileSync(file, JSON.stringify(data,null,2)+'\n', {flag:'wx',mode:0o600}); }
export function validAccount(username, host, port) {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username ?? '')) throw Error('username_requires_1_to_16_java_characters');
  if (typeof host !== 'string' || !host || host.length > 253 || /[\s\/@?#\x00-\x1f]/.test(host)) throw Error('invalid_game_host');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid_game_port');
}
export function loadProfile(directory) {
  const file = join(resolve(directory), 'client.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  validAccount(config.world?.username, config.world?.host, config.world?.port);
  if (config.world.version !== '1.21.1' || !config.dataDir || !config.world.loginConfigFile) throw Error('invalid_skill_profile');
  return {file,config,directory:dirname(file)};
}
export function makeProfile({directory,username,host='micro.kangqiang.site',port=25702,passwordFile,passwordFormat='file',root=SKILL_ROOT}) {
  validAccount(username,host,port);
  if (!['file','dpapi'].includes(passwordFormat) || (passwordFormat === 'dpapi' && (!passwordFile || process.platform !== 'win32'))) throw Error('invalid_password_format');
  directory = resolve(directory);
  if (existsSync(directory)) throw Error('profile_already_exists_use_check_or_config');
  let secret;
  if (passwordFile) secret = readSecret(resolve(passwordFile),passwordFormat);
  else secret = Buffer.from(randomBytes(24).toString('hex'));
  mkdirSync(dirname(directory), {recursive:true,mode:0o700}); mkdirSync(directory,{mode:0o700});
  const privateDir = join(directory,'private');mkdirSync(privateDir,{mode:0o700});
  const credentialFile = join(privateDir, passwordFormat === 'dpapi' || process.platform === 'win32' ? 'game.dpapi' : 'game.secret');
  let credentialFormat;
  try {
    credentialFormat=saveSecret(credentialFile,secret);
  } finally {if(Buffer.isBuffer(secret))secret.fill(0);secret=undefined;}
  const loginFile=join(privateDir,'login.json');
  writeJson(loginFile,{enabled:true,accounts:[{server:`${host}:${port}`,username,credentialFile,credentialFormat,command:'login',timeoutMs:135000,
    requestMarkers:['MC_AUTH_LOGIN'],successMarkers:['MC_AUTH_SUCCESS'],failureMarkers:['MC_AUTH_WRONG','MC_AUTH_LOCKED','MC_AUTH_UNAVAILABLE','MC_AUTH_DENIED']}]});
  const config={dataDir:join(directory,'body-data'),timezone:'Asia/Shanghai',acceptsImages:false,metricsPort:0,consolePort:0,portalConfigFile:join(privateDir,'portal.json'),
    world:{host,port,username,auth:'offline',version:'1.21.1',keepAliveTimeoutMs:180000,loginConfigFile:loginFile,viewerPort:0,
      local:{startWithWorld:false,serverDir:'',cheats:false},client:{enabled:false},player:{enabled:false}}};
  writeJson(join(directory,'client.json'),config);mkdirSync(config.dataDir,{mode:0o700});
  writeJson(join(privateDir,'portal.json'),{baseUrl:'https://mc.kangqiang.site',username,tokenFile:null,tokenFormat:null});
  return mcpConfig(directory,root);
}
export function mcpConfig(directory,root=SKILL_ROOT) {
  const {file,config}=loadProfile(directory);
  const output=join(dirname(file),'mcp.json');
  const value={mcpServers:{qiandengji:{command:process.execPath,args:[join(root,'scripts','mcp.mjs'),file]}}};
  // This generated file contains no credentials and is explicitly regenerated.
  writeFileSync(output,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  return {profile:dirname(file),clientConfig:file,mcpConfig:output,username:config.world.username,
    gameAddress:`${config.world.host}:${config.world.port}`,version:'1.21.1',gameConnected:false,modelCalled:false};
}
function npmCli(explicit) {
  const candidates=[explicit,process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js'),'/usr/share/nodejs/npm/bin/npm-cli.js'].filter(Boolean);
  const found=candidates.find(file=>existsSync(file));if(!found)throw Error('npm_cli_not_found_pass_npm_cli_or_run_npm_ci_in_assets_runtime');return found;
}
export async function main(argv=process.argv.slice(2)) {
  const command=argv.shift();
  if(command==='join'){const{joinSkill}=await import('./join.mjs');return joinSkill(argv);}
  const {values}=parseArgs({args:argv,options:{username:{type:'string'},profile:{type:'string'},host:{type:'string'},port:{type:'string'},
    'password-file':{type:'string'},'password-format':{type:'string'},'token-file':{type:'string'},'portal-url':{type:'string'},'npm-cli':{type:'string'},'skip-install':{type:'boolean'}}});
  if(!['init','check','config','portal'].includes(command))throw Error('usage_setup_join_init_check_config_or_portal');
  const bundle=verifyBundle();
  const directory=values.profile || (values.username ? join(homedir(),'.qiandengji','players',values.username) : null);
  if(!directory)throw Error('profile_or_username_required');
  if(command==='init') {
    validAccount(values.username,values.host??'micro.kangqiang.site',Number(values.port??25702));
    if(existsSync(resolve(directory)))throw Error('profile_already_exists_use_check_or_config');
    if(!values['skip-install']) execFileSync(process.execPath,[npmCli(values['npm-cli']),'ci','--ignore-scripts','--no-audit','--no-fund'],
      {cwd:join(SKILL_ROOT,'assets','runtime'),windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024});
    return makeProfile({directory,username:values.username,host:values.host,port:Number(values.port??25702),passwordFile:values['password-file'],passwordFormat:values['password-format']??'file'});
  }
  if(command==='config')return mcpConfig(directory);
  const {file,config}=loadProfile(directory);
  if(command==='portal') {
    if(!values['token-file'])throw Error('private_portal_token_file_required');
    const {validPortal}=await import('../assets/runtime/portal-client.mjs');
    validPortal(values['portal-url']??'https://mc.kangqiang.site');
    const secret=readPlain(resolve(values['token-file']),'portal');
    const privateDir=join(dirname(file),'private');
    const target=join(privateDir,`portal-${Date.now()}.${process.platform==='win32'?'dpapi':'secret'}`);
    let format;try{format=saveSecret(target,secret);}finally{secret.fill(0);}
    const current=JSON.parse(readFileSync(config.portalConfigFile,'utf8'));
    writeFileSync(config.portalConfigFile,JSON.stringify({...current,baseUrl:values['portal-url']??current.baseUrl,tokenFile:target,tokenFormat:format},null,2)+'\n',{mode:0o600});
    return {portalConfigured:true,username:config.world.username,rawTokenPrinted:false,gameConnected:false,modelCalled:false};
  }
  const runtime=join(SKILL_ROOT,'assets/runtime');
  const sdkVersion=verifyRuntime(SKILL_ROOT,bundle);
  const {loadMinecraftClientConfig}=await import(pathToFileURL(join(runtime,'node_modules/agent-mc-world/dist/runtime/src/client/index.js')));
  const decoded=loadMinecraftClientConfig(file);
  return {configurationValid:true,sdkVersion,version:decoded.cfg.version,username:decoded.cfg.username,gameConnected:false,modelCalled:false};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  // Finish module evaluation before join imports the existing account importer,
  // which itself uses these exports. Avoid a top-level-await import cycle.
  setImmediate(async()=>{
    try{const result=await main();console.log(JSON.stringify(result,null,2));if(process.argv[2]==='join'&&result?.state!=='ready')process.exitCode=2;}
    catch(error){console.error(JSON.stringify({error:error instanceof Error?error.message:'setup_failed'}));process.exitCode=1;}
  });
}
