/** Offline gameplay/application boundary check. No source execution, server data, or emitted build files.
 * Run: node tools/check_architecture.mjs [--self-test]
 * Type-only dependencies are checked from the real TypeScript AST, before bundling.
 * This is an architecture regression check, not a sandbox for hostile source code.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORLD = join(ROOT, 'world')
const require = createRequire(join(WORLD, 'package.json'))
const slash = path => path.replaceAll('\\', '/')
const key = path => process.platform === 'win32' ? slash(resolve(path)).toLowerCase() : slash(resolve(path))
const within = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) }
const sourceExtension = /\.(?:[cm]?ts|tsx)$/i

function sources(root, required = true) {
  const files = []
  if (!required && !existsSync(root)) return files
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      // Do not follow links out of the pure source tree, including directory junctions.
      if (entry.isSymbolicLink() || !within(realpathSync(root), realpathSync(path))) throw new Error(`Source link is not allowed: ${path}`)
      if (entry.isDirectory()) walk(path)
      else if (sourceExtension.test(entry.name)) files.push(path)
      else if (/\.(?:[cm]?js|jsx)$/i.test(entry.name)) throw new Error(`Unchecked JavaScript in checked layers: ${path}`)
    }
  }
  walk(root)
  if (required && !files.length) throw new Error('No gameplay TypeScript sources found')
  return files
}

// The compiler only sees the explicitly supplied source/config/standard-library files.
// Returning null/false/empty entries prevents fallback reads of arbitrary real files.
function virtualFiles(entries) {
  const files = new Map(), dirs = new Map()
  for (const [name, text] of entries) {
    files.set(key(name), text)
    let child = name, directory = dirname(name), isFile = true
    while (child !== directory) {
      const entry = dirs.get(key(directory)) ?? { files: new Set(), directories: new Set() }
      entry[isFile ? 'files' : 'directories'].add(child.slice(directory.length).replace(/^[/\\]+/, ''))
      dirs.set(key(directory), entry)
      child = directory; directory = dirname(directory); isFile = false
    }
  }
  return {
    readFile: name => files.get(key(name)) ?? null,
    fileExists: name => files.has(key(name)),
    directoryExists: name => dirs.has(key(name)),
    getAccessibleEntries: name => { const d = dirs.get(key(name)); return { files: [...(d?.files ?? [])], directories: [...(d?.directories ?? [])] } },
    realpath: name => name,
  }
}

async function check(world, dependencies, bundle = true) {
  const gameplay = join(world, 'src/gameplay'), configPath = join(world, 'tsconfig.gameplay.json')
  const application = join(world, 'src/application')
  const paths = [...sources(gameplay), ...sources(application, false)], texts = new Map(paths.map(path => [path, readFileSync(path, 'utf8')]))
  const configText = readFileSync(configPath, 'utf8'), config = JSON.parse(configText), options = config.compilerOptions
  const errors = [], report = { ok: false, file_count: paths.length, errors }
  const issue = (code, file, message, line) => errors.push({ code, ...(file ? { file: slash(relative(world, file)) } : {}), ...(line ? { line } : {}), message })
  if (config.extends || options?.noCheck === true || options?.noEmit !== true || options?.strict !== true || options?.noResolve !== true ||
      options?.skipLibCheck !== false || JSON.stringify(options?.types) !== '[]' || JSON.stringify(options?.lib) !== '["ES2022"]') {
    issue('config_boundary', configPath, 'Require standalone strict/noEmit/noResolve config, types:[], lib:[ES2022], skipLibCheck:false')
    return report
  }
  const { API, ast, libraries, esbuild } = dependencies
  const api = new API({ cwd: world, fs: virtualFiles([...texts, [configPath, configText], ...libraries]) })
  let snapshot
  try {
    snapshot = api.updateSnapshot({ openProjects: [slash(configPath)] })
    const project = snapshot.getProject(slash(configPath))
    if (!project) throw new Error('TypeScript did not open the gameplay/application project')
    const program = project.program, known = new Set(paths.map(key)), roots = new Set(project.rootFiles.map(key))
    if (paths.some(path => !roots.has(key(path))) || [...roots].some(path => !known.has(path))) {
      issue('config_coverage', configPath, 'The compiler roots must contain every gameplay/application source and no other source')
    }
    for (const path of paths) {
      const source = program.getSourceFile(slash(path))
      if (!source) { issue('missing_ast', path, 'Source is absent from the compiler project'); continue }
      const isGameplay = within(gameplay, path)
      const allowed = target => within(gameplay, target) || (!isGameplay && within(application, target))
      const layer = isGameplay ? 'gameplay' : 'application/gameplay'
      const seen = new Set()
      function dependency(specifier, position, kind) {
        const line = source.getLineAndCharacterOfPosition(Math.max(0, position)).line + 1
        const id = `${position}:${specifier}`
        if (seen.has(id)) return
        seen.add(id)
        if (typeof specifier !== 'string' || !/^\.{1,2}\//.test(specifier) || /[\\?#\0]/.test(specifier)) {
          issue('dependency_boundary', path, `${kind} must name a relative ${layer} module: ${specifier ?? '<computed>'}`, line); return
        }
        const target = resolve(dirname(path), specifier)
        const candidates = [target, ...['.ts', '.mts', '.cts', '.tsx', '/index.ts'].map(ext => target + ext),
          target.replace(/\.mjs$/i, '.mts').replace(/\.cjs$/i, '.cts').replace(/\.js$/i, '.ts')]
        if (!allowed(target) || !candidates.some(candidate => allowed(candidate) && known.has(key(candidate)))) {
          issue('dependency_boundary', path, `${kind} escapes ${layer} or has no checked source: ${specifier}`, line)
        }
      }
      function visit(node) {
        const K = ast.SyntaxKind
        const literal = node => node?.kind === K.StringLiteral || node?.kind === K.NoSubstitutionTemplateLiteral ? node.text : undefined
        if (node.kind === K.ImportDeclaration || node.kind === K.ExportDeclaration) {
          if (node.moduleSpecifier) dependency(literal(node.moduleSpecifier), node.moduleSpecifier.pos, 'import/export')
        } else if (node.kind === K.ImportEqualsDeclaration && node.moduleReference.kind === K.ExternalModuleReference) {
          dependency(literal(node.moduleReference.expression), node.pos, 'import-equals')
        } else if (node.kind === K.ImportType) {
          dependency(literal(node.argument?.literal), node.pos, 'import-type')
        } else if (node.kind === K.CallExpression && (node.expression.kind === K.ImportKeyword ||
          node.expression.kind === K.Identifier && node.expression.text === 'require')) {
          dependency(literal(node.arguments[0]), node.pos, 'dynamic import/require')
        } else if (node.kind === K.ModuleDeclaration && node.name.kind === K.StringLiteral) {
          dependency(node.name.text, node.pos, 'module declaration')
        }
        node.forEachChild(child => { visit(child) })
      }
      visit(source)
      for (const ref of source.referencedFiles) dependency(ref.fileName, ref.pos, 'reference-path')
      for (const ref of [...source.typeReferenceDirectives, ...source.libReferenceDirectives]) {
        issue('ambient_reference', path, `Per-file type/lib reference is forbidden: ${ref.fileName}`, source.getLineAndCharacterOfPosition(ref.pos).line + 1)
      }
    }
    const diagnostics = [...program.getConfigFileParsingDiagnostics(), ...program.getProgramDiagnostics(),
      ...program.getSyntacticDiagnostics(), ...program.getGlobalDiagnostics(), ...program.getSemanticDiagnostics()]
    const seen = new Set()
    for (const diagnostic of diagnostics) {
      if (diagnostic.category !== dependencies.DiagnosticCategory.Error) continue
      const id = `${diagnostic.fileName}:${diagnostic.pos}:${diagnostic.code}`
      if (seen.has(id)) continue
      seen.add(id)
      issue('typescript', diagnostic.fileName, `TS${diagnostic.code}: ${diagnostic.text}`)
    }
  } finally {
    try { snapshot?.dispose() } finally { api.close() }
  }
  if (!errors.length && bundle) {
    try {
      const output = await esbuild.build({ absWorkingDir: world, entryPoints: paths.filter(path => !path.endsWith('.d.ts')),
        outdir: join(world, '.architecture-memory-only'), bundle: true, platform: 'neutral', format: 'esm', target: 'es2022',
        write: false, metafile: true, logLevel: 'silent' })
      if (Object.keys(output.metafile.inputs).some(path => !paths.some(source => key(source) === key(resolve(world, path)))) ||
          Object.values(output.metafile.outputs).some(output => output.imports.length)) {
        issue('bundle_boundary', undefined, 'The bundle retains dependencies outside the checked gameplay/application sources')
      }
    } catch (error) { issue('bundle', undefined, error.message) }
  }
  report.ok = errors.length === 0
  return report
}

async function selfTest(dependencies) {
  const base = mkdtempSync(join(tmpdir(), 'qiandeng-architecture-')), world = join(base, 'world')
  const results = []
  try {
    cpSync(join(WORLD, 'src/gameplay'), join(world, 'src/gameplay'), { recursive: true })
    cpSync(join(WORLD, 'tsconfig.gameplay.json'), join(world, 'tsconfig.gameplay.json'))
    const probe = join(world, 'src/gameplay/_architecture_probe.ts')
    const applicationProbe = join(world, 'src/application/_architecture_probe.ts')
    mkdirSync(dirname(applicationProbe), { recursive: true })
    writeFileSync(join(world, 'src/application/_architecture_service.ts'), 'export interface Fixture { value: string }\n', 'utf8')
    const cases = [
      ['local-type-import', "import type { Atom } from './magic/contracts.ts'; export type Probe = Atom", null],
      ['comments-and-strings', "// import type { Stats } from 'node:fs'\nexport const help = \"import('node:fs')\"", null],
      ['type-only-external', "import type { Stats } from 'node:fs'; export type Probe = Stats", 'dependency_boundary'],
      ['type-only-infrastructure', "import type { StateStore } from '../infrastructure/magic-state-store.ts'; export type Probe = StateStore", 'dependency_boundary'],
      ['reexport-external', "export type { Stats } from 'node:fs'", 'dependency_boundary'],
      ['reexport-agent', "export * from '../mc-god.ts'", 'dependency_boundary'],
      ['import-type', "export type Probe = import('node:fs').Stats", 'dependency_boundary'],
      ['side-effect-import', "import 'node:fs'; export {}", 'dependency_boundary'],
      ['dynamic-import', "export const load = () => import('node:fs')", 'dependency_boundary'],
      ['computed-import', "export const load = (path: string) => import(path)", 'dependency_boundary'],
      ['import-equals', "import FS = require('node:fs'); export type Probe = typeof FS", 'dependency_boundary'],
      ['ambient-reference', '/// <reference lib="dom" />\nexport {}', 'ambient_reference'],
      ['global-io', "export const load = () => fetch('https://invalid.example'); export const log = () => console.log('probe')", 'typescript'],
      ['application-to-gameplay', "import type { NativeSpell } from '../gameplay/native/contracts.ts'; export type Probe = NativeSpell", null, 'application'],
      ['application-to-application', "import type { Fixture } from './_architecture_service.ts'; export type Probe = Fixture", null, 'application'],
      ['application-type-external', "import type { Stats } from 'node:fs'; export type Probe = Stats", 'dependency_boundary', 'application'],
      ['application-reexport-infrastructure', "export type { StateStore } from '../infrastructure/magic-state-store.ts'", 'dependency_boundary', 'application'],
      ['application-import-type-agent', "export type Probe = import('../mc-god.ts').GodService", 'dependency_boundary', 'application'],
      ['application-global-io', "export const load = () => fetch('https://invalid.example')", 'typescript', 'application'],
      ['application-computed-import', "export const load = (path: string) => import(path)", 'dependency_boundary', 'application'],
      ['gameplay-to-application-type', "import type { Fixture } from '../application/_architecture_service.ts'; export type Probe = Fixture", 'dependency_boundary'],
      ['gameplay-to-application-export', "export type { Fixture } from '../application/_architecture_service.ts'", 'dependency_boundary'],
      ['gameplay-to-application-import-type', "export type Probe = import('../application/_architecture_service.ts').Fixture", 'dependency_boundary'],
      ['gameplay-to-application-dynamic', "export const load = () => import('../application/_architecture_service.ts')", 'dependency_boundary'],
    ]
    for (const [name, text, expected, layer] of cases) {
      writeFileSync(probe, layer === 'application' ? 'export {}\n' : text + '\n', 'utf8')
      writeFileSync(applicationProbe, layer === 'application' ? text + '\n' : 'export {}\n', 'utf8')
      const result = await check(world, dependencies, false)
      results.push({ name, ok: expected ? !result.ok && result.errors.some(error => error.code === expected) : result.ok,
        observed_codes: [...new Set(result.errors.map(error => error.code))] })
    }
  } finally {
    const target = realpathSync(base), temporaryRoot = realpathSync(tmpdir())
    if (!within(temporaryRoot, target) || !relative(temporaryRoot, target).startsWith('qiandeng-architecture-') || lstatSync(base).isSymbolicLink()) {
      throw new Error('Refusing cleanup outside the owned temporary test directory')
    }
    rmSync(target, { recursive: true, force: true })
  }
  return { ok: results.every(result => result.ok), cases: results, temporary_copy_removed: true }
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--self-test')) throw new Error('Usage: node tools/check_architecture.mjs [--self-test]')
  const sync = await import(pathToFileURL(require.resolve('typescript/unstable/sync')))
  const ast = await import(pathToFileURL(require.resolve('typescript/unstable/ast')))
  const libDir = join(dirname(require.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`)), 'lib')
  const libraries = readdirSync(libDir).filter(name => /^lib\..*\.d\.ts$/.test(name)).map(name => {
    const path = join(libDir, name); return [path, readFileSync(path, 'utf8')]
  })
  const dependencies = { ...sync, ast, libraries, esbuild: require('esbuild') }
  const report = await check(WORLD, dependencies)
  if (process.argv.includes('--self-test')) { report.self_test = await selfTest(dependencies); report.ok &&= report.self_test.ok }
  else report.self_test = { skipped: true }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.ok ? 0 : 1
}
main().catch(error => {
  process.stdout.write(JSON.stringify({ ok: false, file_count: 0, errors: [{ code: 'checker_error', message: error.message }], self_test: { skipped: true } }, null, 2) + '\n')
  process.exitCode = 1
})
