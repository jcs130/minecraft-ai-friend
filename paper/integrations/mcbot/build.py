"""Compile an independent Paper adapter and a pinned, narrow Numen driver hook.

No server is started; no runtime directory or player data is modified.
Numen sources/hooks retain LGPL-3.0-only; the independent adapter is MIT.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile

ROOT=Path(__file__).resolve().parent
NUMEN_BASE_DIGEST='7380a3260ab8b291536c748ae6c7094daf3cbb921643f8700d1193b50c0fd31a'
SOURCE='287ac6e5d492ea73323fc4eb4ce668aacac89130'
CONTENT='82133ebd12d89db5b7af515160562b64296eebca119f1e0473761ccd85c2bab1'
p=argparse.ArgumentParser(description=__doc__)
for n in ['jdk','source','api','content','server','output']:p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args();out=a.output.resolve()
assert not out.exists(),'Use a new output directory'
assert hashlib.sha256(a.api.read_bytes()).hexdigest()==NUMEN_BASE_DIGEST,'Unreviewed Numen API'
assert hashlib.sha256(a.content.read_bytes()).hexdigest()==CONTENT,'Unreviewed Numen content'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=a.source,text=True).strip()==SOURCE,'Unreviewed source revision'
out.mkdir(parents=True);patch=out/'numen-src';patch.mkdir();classes=out/'api-classes';classes.mkdir()
sources=[]
old_driving='() -> com.dwinovo.numen.api.mcp.server.McpMode.instance().driving(owner, companion)\n                        || ReleaseClients.driving(owner, companion)'
new_driving='() -> ClientDrivers.driving(owner, companion)\n                        || com.dwinovo.numen.api.mcp.server.McpMode.instance().driving(owner, companion)\n                        || ReleaseClients.driving(owner, companion)'
for name,old,new in [
 ('CompanionBrains',old_driving,new_driving),
 ('ReleaseClients','&& !McpMode.instance().driving(owner, body);','&& !McpMode.instance().driving(owner, body) && !ClientDrivers.driving(owner, body);')]:
 rel='numen-api/common/src/main/java/com/dwinovo/numen/api/brain/'+name+'.java'
 raw=subprocess.check_output(['git','show',SOURCE+':'+rel],cwd=a.source).decode('utf8')
 assert raw.count(old)==1,'Driver hook context changed: '+name
 target=patch/(name+'.java');target.write_text(raw.replace(old,new),encoding='utf8');sources.append(target)
sources+=sorted((ROOT/'numen').glob('*.java'))

# Connection-owned calls are checked on the main lane, including delayed task preparation.
# The native resident brain keeps its original restart-resume behaviour.
native_patches={
 'permission/PlacedBlocks':[(
  'private final ConcurrentHashMap<Long, Long2ObjectMap<Placer>> byChunk = new ConcurrentHashMap<>();',
  'private volatile ServerLevel currentLevel;\n    private final ConcurrentHashMap<Long, Long2ObjectMap<Placer>> byChunk = new ConcurrentHashMap<>();'),(
  'return level.getDataStorage().computeIfAbsent(FACTORY, "numen_placed");',
  'PlacedBlocks placed = level.getDataStorage().computeIfAbsent(FACTORY, "numen_placed");\n        placed.currentLevel = level; return placed;'),(
  'if (now.isAir()) {\n            forget(pos);',
  'if (now.isAir()) {\n            // Planning views may predate a placement. Only live main-thread air can erase its provenance.\n'
  '            ServerLevel level = currentLevel;\n'
  '            if (level != null && level.getServer().isSameThread() && level.hasChunkAt(pos)\n'
  '                    && level.getBlockState(pos).isAir()) forget(pos);')],
 'program/ServerCalls':[(
  'lane.post(() -> {\n            Dispatcher.serve',
  'lane.post(() -> {\n            if (!com.dwinovo.numen.api.brain.ConnectionCalls.allows(companion, callId)) {\n'
  '                done.accept(ApiReply.error(com.dwinovo.numen.script.ErrorKind.FAILED, "connection ended; call not started", null, null).toString());\n'
  '                return;\n            }\n            Dispatcher.serve')],
 'entity/Mouse':[(
  'public void release() {\n        if (destroying != null) {',
  'public void release() {\n        if (stopped != null) {\n'
  '            send(ServerboundPlayerActionPacket.Action.ABORT_DESTROY_BLOCK, stopped, Direction.DOWN);\n'
  '            stopped = null; stoppedState = null;\n        }\n        if (destroying != null) {')],
 'task/TaskDispatch':[(
  'record.replyTo(reply);',
  'if (!com.dwinovo.numen.api.brain.ConnectionCalls.watch(companion.getUUID(), record.getToolCallId(),\n'
  '                () -> { if (!record.getState().isTerminal()) record.stop(TaskRecord.StopCause.OWNER); })) {\n'
  '            reply.accept(TaskResult.cancelled("connection ended; call not started")); return;\n        }\n        record.replyTo(reply);'),(
  'if (readiness.ready()) {',
  'if (readiness.ready()) {\n'
  '                if (!com.dwinovo.numen.api.brain.ConnectionCalls.watch(companion.getUUID(), record.getToolCallId(),\n'
  '                        () -> { if (!record.getState().isTerminal()) record.stop(TaskRecord.StopCause.OWNER); })) {\n'
  '                    refused.accept(TaskResult.cancelled("connection ended; task not started")); return;\n                }'),(
  'TaskPersistence.remember(companion, record.getToolName(), replay);',
  'if (com.dwinovo.numen.api.brain.ConnectionCalls.transientCall(record.getToolCallId())) TaskPersistence.forget(companion);\n'
  '                else TaskPersistence.remember(companion, record.getToolName(), replay);')]
}
for rel,replacements in native_patches.items():
 raw=subprocess.check_output(['git','show',SOURCE+':numen-api/common/src/main/java/com/dwinovo/numen/api/'+rel+'.java'],cwd=a.source).decode('utf8')
 for old,new in replacements:
  assert raw.count(old)==1,'Connection lifetime patch context changed: '+rel
  raw=raw.replace(old,new)
 target=patch/(rel.split('/')[-1]+'.java');target.write_text(raw,encoding='utf8');sources.append(target)
token_rel='numen-api/common/src/main/java/com/dwinovo/numen/api/mcp/server/TokenCommands.java'
token_raw=subprocess.check_output(['git','show',SOURCE+':'+token_rel],cwd=a.source).decode('utf8')
for old,new in [
 ('ctx.getSource().sendSuccess(() -> Component.translatable(Keys.COMMAND_TOKEN_ISSUED, issued.token().id(),\n                role.name().toLowerCase(Locale.ROOT), describe(issued.token())), false);',
  'owner.sendSystemMessage(Component.translatable(Keys.COMMAND_TOKEN_ISSUED, issued.token().id(),\n                role.name().toLowerCase(Locale.ROOT), describe(issued.token())));'),
 ('ctx.getSource().sendSuccess(() -> Component.literal(issued.secret().substring(0, SHOWN) + "…").withStyle(Style.EMPTY\n                .withClickEvent(new ClickEvent(ClickEvent.Action.COPY_TO_CLIPBOARD, issued.secret()))\n                .withUnderlined(true)), false);',
  'owner.sendSystemMessage(Component.literal(issued.secret().substring(0, SHOWN) + "…").withStyle(Style.EMPTY\n                .withClickEvent(new ClickEvent(ClickEvent.Action.COPY_TO_CLIPBOARD, issued.secret()))\n                .withUnderlined(true)));'),
 ('ctx.getSource().sendSuccess(() -> Component.translatable(Keys.COMMAND_TOKEN_ENDPOINT_OFF), false);',
  'owner.sendSystemMessage(Component.translatable(Keys.COMMAND_TOKEN_ENDPOINT_OFF));')]:
 assert token_raw.count(old)==1,'Private token delivery patch context changed'
 token_raw=token_raw.replace(old,new)
token_src=patch/'TokenCommands.java';token_src.write_text(token_raw,encoding='utf8');sources.append(token_src)
core=a.server/'versions/1.21.1/paper-1.21.1.jar';assert core.is_file()
libraries=sorted((a.server/'libraries').rglob('*.jar'))
cp=os.pathsep.join(map(str,[a.api,a.content,core,*libraries]))
suffix='.exe'if os.name=='nt'else'';java=a.jdk/'bin'
def run(tool,args,label):
 f=out/(label+'.args');f.write_text('\n'.join('"'+str(v).replace('\\','/')+'"'for v in args),encoding='utf8')
 subprocess.run([str(java/(tool+suffix)),'@'+str(f)],check=True)
run('javac',['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',classes,*sources],'api')
prefix='com/dwinovo/numen/api/brain/'
roots=['CompanionBrains','ReleaseClients','ClientDriverBook','ClientDrivers','ConnectionCalls']
def owned(name):return any(name==prefix+n+'.class'or name.startswith(prefix+n+'$')for n in roots)or name=='com/dwinovo/numen/api/mcp/server/TokenCommands.class'or name.startswith('com/dwinovo/numen/api/mcp/server/TokenCommands$')or any(name=='com/dwinovo/numen/api/'+n+'.class'or name.startswith('com/dwinovo/numen/api/'+n+'$')for n in native_patches)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')}
assert all(owned(n)for n in compiled)
api=out/'numen_api-paper-1.21.1-0.1.4-mcbot1.jar';retained=0
with zipfile.ZipFile(a.api)as src,zipfile.ZipFile(api,'w',zipfile.ZIP_DEFLATED)as dst:
 for entry in src.infolist():
  if owned(entry.filename):
   assert entry.filename in compiled,'Missing nested class';continue
  dst.writestr(entry,src.read(entry));retained+=1
 for name,data in compiled.items():dst.writestr(name,data)
content_src=out/'content-src';content_src.mkdir();content_classes=out/'content-classes';content_classes.mkdir()
raw=subprocess.check_output(['git','show',SOURCE+':numen/common/src/main/java/com/dwinovo/numen/tools/MenuOps.java'],cwd=a.source).decode('utf8')
needle='public static void dripInto(AbstractContainerMenu menu, Player who, int from, int to, int count) {'
assert raw.count(needle)==1,'Furnace cursor patch context changed'
target=content_src/'MenuOps.java';target.write_text(raw.replace(needle,needle+'\n        if (ExactFurnaceOutput.move(menu, who, from, to, count)) return;'),encoding='utf8')
content_sources=[target,*sorted((ROOT/'numen-content').glob('*.java'))]
run('javac',['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',str(api)+os.pathsep+cp,'-d',content_classes,*content_sources],'content')
content=out/'numen-paper-1.21.1-0.1.4-mcbot1.jar';content_entries={f.relative_to(content_classes).as_posix():f.read_bytes()for f in content_classes.rglob('*.class')}
assert set(content_entries)=={'com/dwinovo/numen/tools/MenuOps.class','com/dwinovo/numen/tools/ExactFurnaceOutput.class'}
retained_content=0
with zipfile.ZipFile(a.content)as src,zipfile.ZipFile(content,'w',zipfile.ZIP_DEFLATED)as dst:
 for entry in src.infolist():
  if entry.filename in content_entries:continue
  dst.writestr(entry,src.read(entry));retained_content+=1
 for name,data in content_entries.items():dst.writestr(name,data)
addon_classes=out/'classes';addon_classes.mkdir()
addon_sources=sorted((ROOT/'src').rglob('*.java'))
run('javac',['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',str(api)+os.pathsep+cp,'-d',addon_classes,*addon_sources],'adapter')
jar=out/'QiandengjiMcbot-0.1.0.jar'
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED)as dst:
 for f in addon_classes.rglob('*.class'):dst.writestr(f.relative_to(addon_classes).as_posix(),f.read_bytes())
 for name in ['paper-plugin.yml','config.yml']:dst.writestr(name,(ROOT/name).read_bytes())
 dst.writestr('META-INF/MANIFEST.MF','Manifest-Version: 1.0\r\npaperweight-mappings-namespace: mojang\r\n\r\n')
manifest={'sourceRevision':SOURCE,'apiBaseSha256':NUMEN_BASE_DIGEST,'contentSha256':CONTENT,'retainedApiEntries':retained,
 'apiChangedClasses':sorted(compiled),'contentChangedClasses':sorted(content_entries),'retainedContentEntries':retained_content,
 'sources':{f.relative_to(ROOT).as_posix():hashlib.sha256(f.read_bytes()).hexdigest()for f in [*addon_sources,*sorted((ROOT/'numen').glob('*.java')),*sorted((ROOT/'numen-content').glob('*.java'))]},
 'buildInputs':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest()for name in ['build.py','paper-plugin.yml','config.yml']},
 'paperCoreSha256':hashlib.sha256(core.read_bytes()).hexdigest(),
 'artifacts':{f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in [api,content,jar]},'productionChanged':False}
(out/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
print(json.dumps({'built':manifest['artifacts'],'retainedApiEntries':retained}))
