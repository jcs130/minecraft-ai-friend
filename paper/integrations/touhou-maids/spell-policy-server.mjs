import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const prefix = '/v1/combat-effect/';
const memoryDirectory = process.env.QD_SPELL_POLICY_DATA_DIR;
const anchor = process.env.QD_SPELL_POLICY_CORE_ANCHOR;
const tokenFile = process.env.QD_SPELL_POLICY_TOKEN_FILE;
const port = Number(process.env.QD_SPELL_POLICY_PORT);
const endpoint = new URL(process.env.QD_SPELL_POLICY_SYSTEM_ONE ?? 'http://127.0.0.1:8090/v1/systemone');
if (!Number.isInteger(port) || port < 1024 || port > 65535
    || ![memoryDirectory,anchor,tokenFile].every(path => path && isAbsolute(path))
    || !/^http:\/\/127\.0\.0\.1:\d+\/v1\/systemone$/.test(endpoint.href)
    || Number(endpoint.port) === port) throw Error('Provide the explicit local port, core anchor, data directory and policy token file');
const token = (await readFile(tokenFile, 'utf8')).trim();
if (!/^[0-9a-f]{64}$/.test(token)) throw Error('Policy token file must contain 32 random bytes encoded as lowercase hex');
const expected = Buffer.from('Bearer ' + token);
const modulePath = createRequire(anchor).resolve('agent-mc-world/decisions');
const { createCombatEffectPolicy, createHttpDecisionPort } = await import(pathToFileURL(modulePath));
const policy = createCombatEffectPolicy({directory:memoryDirectory,
  port:createHttpDecisionPort(() => ({endpoint:endpoint.href,timeoutMs:450}))});

async function readBody(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 16_384) throw Error('Payload too large');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
function reply(res, code, data) {
  res.writeHead(code, {'content-type':'application/json', 'cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
const server = createServer({requestTimeout:2000, headersTimeout:1000, keepAliveTimeout:1000}, async (req,res) => {
  const presented = Buffer.from(req.headers.authorization ?? '');
  if (req.headers.origin || presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return reply(res,403,{error:'forbidden'});
  }
  if (req.method === 'GET' && req.url === prefix + 'health') return reply(res,200,{status:'ok'});
  if (req.method !== 'POST' || !['choose','observe'].some(route => req.url === prefix + route)) {
    return reply(res,404,{error:'unknown_route'});
  }
  if (req.headers['content-type'] !== 'application/json') return reply(res,415,{error:'application_json_required'});
  try {
    const input = await readBody(req);
    const choiceRoute = req.url === prefix + 'choose';
    const value = choiceRoute ? await policy.choose(input.frame,input.decisionId) : policy.observe(input);
    reply(res,200,value);
  } catch {
    // Avoid exposing combat observations, file paths or provider errors.
    reply(res,422,{error:'policy_request_rejected'});
  }
});
server.maxConnections = 12;
server.listen(port,'127.0.0.1',() => process.stdout.write('MC combat-effect policy ready on loopback\n'));
