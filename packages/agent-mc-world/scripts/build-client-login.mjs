/** Compile against the installed Fabric 1.20.6 client without starting a game. */
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {delimiter, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const gameDir = args[0] && resolve(args[0]);
const javaIndex = args.indexOf('--java-home');
const javaDir = javaIndex >= 0 ? args[javaIndex + 1] : process.env.JAVA_HOME;
if (!gameDir || !existsSync(join(gameDir, '.fabric', 'remappedJars')))
  throw new Error('Supply a previously launched Fabric 1.20.6 game directory');
const work = join(root, 'scratch', 'client-login');
const classes = join(work, 'classes');
const deps = join(work, 'deps');
mkdirSync(classes, {recursive:true});
mkdirSync(deps, {recursive:true});
function jars(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? jars(file) : file.endsWith('.jar') ? [file] : [];
  });
}
function run(name, argv, cwd = root) {
  const executable = javaDir ? join(javaDir, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const result = spawnSync(executable, argv, {cwd, windowsHide:true, encoding:'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name}: ${result.stdout}\n${result.stderr}`);
  if (result.stdout.trim()) process.stdout.write(result.stdout);
}
const api = jars(join(gameDir, 'mods')).find(file => /fabric-api-[^/\\]+\+1\.20\.6\.jar$/.test(file));
const minecraft = jars(join(gameDir, '.fabric', 'remappedJars')).find(file =>
  file.includes('minecraft-1.20.6-') && file.endsWith('client-intermediary.jar'));
if (!api || !minecraft) throw new Error('Installed Fabric API and Minecraft 1.20.6 cache are required');
run('jar', ['--extract', '--file', api], deps);
const classpath = [minecraft, ...jars(join(gameDir, 'libraries')), ...jars(join(deps, 'META-INF/jars'))].join(delimiter);
const owner = join(root, 'client-login');
const quote = value => `"${value.replaceAll('\\', '/').replaceAll('"', '\\"')}"`;
const sources = ['LoginSession.java', 'ReconnectSession.java', 'CorticoClientLogin.java', 'LoginSessionCheck.java', 'ReconnectSessionCheck.java'].map(file => join(owner, file));
const argFile = join(work, 'javac.args');
writeFileSync(argFile, ['--release','21','-encoding','UTF-8','-proc:none','-classpath',classpath,'-d',classes,...sources].map(quote).join('\n'));
run('javac', ['@' + argFile]);
run('java', ['-cp', classes + delimiter + classpath, 'LoginSessionCheck']);
run('java', ['-cp', classes + delimiter + classpath, 'ReconnectSessionCheck']);
const manifest = JSON.parse(readFileSync(join(owner, 'fabric.mod.json'), 'utf8'));
const output = join(work, `${manifest.id}-${manifest.version}.jar`);
run('jar', ['--create','--file',output,'-C',classes,'org','-C',owner,'fabric.mod.json']);
if (args.includes('--install')) {
  const target = join(gameDir, 'mods', `${manifest.id}.jar`);
  copyFileSync(output, target);
  console.log(`Installed ${target}; reload only this native client to activate`);
} else console.log(output);
