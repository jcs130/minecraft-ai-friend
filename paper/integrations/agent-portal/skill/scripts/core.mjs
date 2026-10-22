#!/usr/bin/env node
// Inspect the exact packaged MC core. This script never opens a game body;
// execute routines through mc_script on the one existing MCP connection.
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function core(args) {
  const [action = 'help', ...rest] = args;
  if (['help', '--help', '-h'].includes(action)) return { usage: ['core.mjs list', 'core.mjs read ROUTINE_ID', 'core.mjs read ROUTINE_ID --source', 'core.mjs check ROUTINE_ID --params-file PRIVATE_JSON'],
    install: '先按 references/connect.md 安装包内锁定依赖。', execute: '通过已有 MCP 的 mc_script 调用 routine，不另起身体或模型。', mutation: false };
  if (!['list', 'read', 'check'].includes(action)) throw Error('USE_LIST_READ_OR_CHECK_EXECUTE_WITH_EXISTING_MCP');
  const id = action === 'list' ? null : rest.shift();
  const { values } = parseArgs({ args: rest, options: { source: { type: 'boolean' }, 'params-file': { type: 'string' } } });
  const module = await import(pathToFileURL(path.join(root, 'assets/runtime/node_modules/agent-mc-world/dist/runtime/core/work-routines.js')));
  if (action === 'list') return { routines: module.listWorkRoutines(), gameConnected: false, modelCalled: false };
  if (action === 'check') {
    if (!values['params-file']) throw Error('PARAMS_FILE_REQUIRED');
    const stat = await fs.stat(values['params-file']); if (stat.size > 65536) throw Error('PARAMS_TOO_LARGE');
    const prepared = module.prepareWorkRoutine(id, JSON.parse(await fs.readFile(values['params-file'], 'utf8')));
    return { valid: true, routine: prepared.routine, executionTool: 'mc_script', mutation: false, message: '参数结构通过；地形、权限、资源与抵达仍需由实际现场验收。' };
  }
  const result = module.readWorkRoutine(id); if (!values.source) delete result.code;
  return { ...result, executeWith: { tool: 'mc_script', arguments: { routine: { op: 'run', id }, params: '按 parameters 填入实际现场参数' } }, gameConnected: false, modelCalled: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await core(process.argv.slice(2)), null, 2)); }
  catch { console.error(JSON.stringify({ error: 'CORE_INSPECTION_FAILED', message: '先安装包内锁定依赖，用 list 查真实脚本 ID，再 read 查看参数；参数不正确不执行。' })); process.exitCode = 1; }
}
