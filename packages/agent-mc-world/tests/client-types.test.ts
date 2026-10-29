import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('type-checks the standalone SDK with all Cortico module resolution forbidden', () => {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true,
    allowImportingTsExtensions: true, esModuleInterop: true, skipLibCheck: true, types: ['node'] };
  const host = ts.createCompilerHost(options), forbidden: string[] = [];
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, options, source) => literals.map(literal => {
    const name = literal.text;
    if (name === 'cortico' || name.startsWith('cortico/')) { forbidden.push(name); return { resolvedModule: undefined }; }
    return ts.resolveModuleName(name, containingFile, options, host, undefined, redirected, ts.getModeForUsageLocation(source, literal, options));
  });
  const entry = fileURLToPath(new URL('../src/client/index.ts', import.meta.url));
  const program = ts.createProgram([entry], options, host);
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  expect(forbidden).toEqual([]);
  expect(errors.map(d => `${d.file?.fileName}:${d.start} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)).toEqual([]);
}, 30000);

it.each(['Bundler','NodeNext'] as const)('consumes published declarations in %s without framework or private implementation', mode => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const entry = join(root, 'tests', 'sdk-declaration-consumer.ts');
  const source = `import * as mcp from '../dist/types/src/mcp/server.js';
    import * as stdio from '../dist/types/src/mcp/stdio.js';
    import {createRelay} from '../dist/types/bridges/performance/relay.mjs';
    import * as extension from '../dist/types/src/extension.js';
    import { readMinecraftKnowledge, KNOWLEDGE_TOOL, withFactState, type FactState } from '../dist/types/src/client/index.js';
    import type { FactPart } from '../dist/types/src/contracts/index.js';
    const semantic: FactState = { position: [1,64,2], mana: null, lastCastAt: 'dated' };
    const dated: FactPart = withFactState({key:'state',text:'raw dated evidence'}, semantic);
    void dated.stateRevision;
    import { planInventoryShortcutExchange, type InventoryShortcutExchange } from '../dist/types/src/client/index.js';
    const exchanges: InventoryShortcutExchange[] | null = planInventoryShortcutExchange([], {kind:'swap',from:0,to:1,source:'',destination:''},0,2,0);
    void exchanges;
    const reference: Record<string, unknown> = readMinecraftKnowledge({action:'get',id:'food/beef'},'1.21.1');
    void reference; void KNOWLEDGE_TOOL;
    void mcp;void stdio;void createRelay;void extension;
    import {Bridge, type MinecraftBot} from '../dist/types/src/extension.js';
    class ServerBridge extends Bridge {
      protected override createProtectionPort(bot: MinecraftBot) { void bot; return null; }
    }
    void ServerBridge;
    import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger,
    type ToolOutcome, type EventEnvelope } from '../dist/types/src/client/index.js';
    const client = new MinecraftAgentClient({ cfg: MINECRAFT_CLIENT_DEFAULTS, dataDir:'./data', log:nullLogger() });
    const result: Promise<ToolOutcome> = client.call('mc_script', {api:'index'});
    const events: EventEnvelope[] = client.journal.read(0, 8).events;
    void result; void events;
    import { JavaClientWorld, validateJavaClientConfiguration, JAVA_CLIENT_PROTOCOL,
      type JavaClientConfiguration, type JavaClientAction, type JavaClientState } from '../dist/types/src/client/index.js';
    const native: JavaClientConfiguration = {expectedUuid:'12345678-1234-1234-1234-123456789abc',expectedServer:'fixture.test',controllerId:'consumer',credentialsFile:'./connection.json',ledgerDir:'./ledger',leaseMs:15000};
    validateJavaClientConfiguration(native);
    const body = new JavaClientWorld({...MINECRAFT_CLIENT_DEFAULTS,provider:'java-client',javaClient:native});
    const nativeAction: JavaClientAction = {id:'id',operation:'move',phase:'unknown',acceptedAt:0,updatedAt:0};
    const nativeState: JavaClientState = {protocol:JAVA_CLIENT_PROTOCOL,connected:false,server:'',sampledAt:'now',generation:0,actions:[nativeAction],messages:[]};
    void body;void nativeState;
    import { PhotographyService, preparePhotoContext,
      type PhotoRecord, type ImageGenerationPort, type PhotographyConfig } from '../dist/types/src/client/index.js';
    import { PHOTOGRAPHY_PROTOCOL, type PhotoCapture } from '../dist/types/src/contracts/index.js';
    const config: PhotographyConfig = { provider:'none', endpoint:'', model:'', apiKeyEnv:'', generate:true, edit:true, maxReferences:3, timeoutMs:600000, resultHosts:'' };
    const localPhoto: PhotographyConfig = {...config,provider:'comfyui-flux3',endpoint:'http://127.0.0.1:8191',model:'fixture-flux3',
      flux3:{unet:'unet.safetensors',clip:'clip.safetensors',vae:'vae.safetensors',steps:16,width:1280,height:704},
      voxel:{rendererSource:'/explicit/shared-renderer',assetPack:'/explicit/original-assets',threeModule:'/explicit/three.module.js',radius:24,below:8,above:24,cameraOffset:[3,3,4]}};
    void localPhoto;
    const port: ImageGenerationPort | null = null;
    const photo: PhotoRecord = { schema:PHOTOGRAPHY_PROTOCOL, id:'id', action:'capture', phase:'completed', createdAt:'now', updatedAt:'now' };
    const capture: PhotoCapture = { bytes:new Uint8Array(), mime:'image/png', captureId:'id', capturedAt:'now', sampledAt:'now', facts:{} };
    const photos = new PhotographyService({capture:async()=>capture,provider:()=>port});
    preparePhotoContext(photo,'intent',{contextTokens:20000,reservedOutputTokens:1000,imageInputTokens:1000});
    void photos;`;
  const options: ts.CompilerOptions = {target:ts.ScriptTarget.ES2022,module:mode==='NodeNext'?ts.ModuleKind.NodeNext:ts.ModuleKind.ESNext,
    moduleResolution:mode==='NodeNext'?ts.ModuleResolutionKind.NodeNext:ts.ModuleResolutionKind.Bundler,
    strict:true,noEmit:true,esModuleInterop:true,skipLibCheck:false,types:['node']};
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host), forbidden: string[] = [];
  host.getSourceFile = (file, language, error, fresh) => file.replaceAll('\\', '/') === entry.replaceAll('\\', '/')
    ? ts.createSourceFile(file, source, language) : original(file, language, error, fresh);
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, options, source) => literals.map(literal => {
    const name = literal.text;
    if (name === 'cortico' || name.startsWith('cortico/')) { forbidden.push(name); return { resolvedModule: undefined }; }
    return ts.resolveModuleName(name, containingFile, options, host, undefined, redirected, ts.getModeForUsageLocation(source, literal, options));
  });
  const program = ts.createProgram([entry], options, host);
  expect(forbidden).toEqual([]);
  expect(ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  expect(program.getSourceFiles().some(file => /\/(?:engine|core)\/world\.ts$/.test(file.fileName))).toBe(false);
});
