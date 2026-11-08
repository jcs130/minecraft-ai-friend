import {readFile,mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Standalone component test. Does not start a game, read operator config or
// connect to any model. Supply the verified JUnit console dependency explicitly.
const jar=process.env.QDJ_JUNIT_CONSOLE_JAR;
if(!jar)throw Error('Set QDJ_JUNIT_CONSOLE_JAR to junit-platform-console-standalone-1.11.4.jar');
const expected='b016ef6b1c3454d6d7c2c88ce081dabf289699686af6622d6e4e2e1b54b4a2fc';
if(createHash('sha256').update(await readFile(jar)).digest('hex')!==expected)throw Error('JUnit console checksum mismatch');
const patch=await readFile(new URL('../native/upstream.patch',import.meta.url),'utf8');
const directory=await mkdtemp(join(tmpdir(),'hosted-native-lease-'));
try {
  const source=join(directory,'src','com','dwinovo','numen','api','entity'),classes=join(directory,'classes');
  await mkdir(source,{recursive:true});await mkdir(classes);
  const files=[];
  for(const name of ['HostedControlLease.java','HostedControlLeaseTest.java']) {
    const sections=patch.split('diff --git ').filter(s=>s.split('\n')[0].endsWith('/'+name));
    if(sections.length!==1||!sections[0].includes('new file mode'))throw Error('Native lease source could not be extracted unchanged');
    const content=sections[0].split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1)).join('\n')+'\n';
    const path=join(source,name);await writeFile(path,content);files.push(path);
  }
  const extra=join(source,'HostedLeaseRecoveryTest.java');
  await copyFile(new URL('./native/HostedLeaseRecoveryTest.java',import.meta.url),extra);files.push(extra);
  execFileSync('java',['-m','jdk.compiler/com.sun.tools.javac.Main','--source','21','--target','21','-cp',resolve(jar),'-d',classes,...files],{stdio:'inherit'});
  execFileSync('java',['-jar',resolve(jar),'execute','--class-path',classes,'--scan-class-path','--fail-if-no-tests','--disable-ansi-colors','--details','summary'],{stdio:'inherit'});
} finally {await rm(directory,{recursive:true,force:true});}
