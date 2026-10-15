/** Compile against the explicitly selected Fabric client; 1.21.1 is the primary target. */
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {delimiter, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const gameDir = args[0] && resolve(args[0]);
const javaIndex = args.indexOf('--java-home');
const javaDir = javaIndex >= 0 ? args[javaIndex + 1] : process.env.JAVA_HOME;
const versionIndex = args.indexOf('--minecraft');
const version = versionIndex >= 0 ? args[versionIndex + 1] : '1.21.1';
if (!['1.20.6', '1.21.1'].includes(version)) throw new Error('Unsupported Minecraft build target');
if (!gameDir || !existsSync(join(gameDir, '.fabric', 'remappedJars')))
  throw new Error('Supply a previously launched matching Fabric game directory');
const work = join(root, 'scratch', 'client-login', version);
const classes = join(work, 'classes');
const deps = join(work, 'deps');
for (const directory of [classes, deps]) {
  if (!directory.startsWith(resolve(root, 'scratch', 'client-login') + pathSeparator())) throw new Error('Unsafe build directory');
  rmSync(directory, {recursive:true, force:true});
}
function pathSeparator() { return process.platform === 'win32' ? '\\' : '/'; }
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
const api = jars(join(gameDir, 'mods')).find(file => file.includes('fabric-api-') && file.endsWith('+' + version + '.jar'));
const minecraft = jars(join(gameDir, '.fabric', 'remappedJars')).find(file =>
  file.includes('minecraft-' + version + '-') && file.endsWith('client-intermediary.jar'));
if (!api || !minecraft) throw new Error('Matching installed Fabric API and Minecraft cache are required');
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
manifest.depends.minecraft = version;
writeFileSync(join(work, 'fabric.mod.json'), JSON.stringify(manifest, null, 2) + '\n');
const output = join(work, `${manifest.id}-${manifest.version}.jar`);
run('jar', ['--create','--file',output,'-C',classes,'org','-C',work,'fabric.mod.json']);
if (args.includes('--install')) {
  const target = join(gameDir, 'mods', `${manifest.id}.jar`);
  copyFileSync(output, target);
  console.log(`Installed ${target}; reload only this native client to activate`);
} else console.log(output);
