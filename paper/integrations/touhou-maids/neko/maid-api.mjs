import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Agent, createServer, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const protocol = 'qiandengji-maid-body/v1';
const route = '/api/v1/maid-body';
const bodyLimit = 16_384;
const nativeReplyLimit = 2_097_152;
const leaseMs = 120_000; // NativeMaidBodyPort's lease window.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyPattern = /^Bearer ((?:mda|mdw)_[A-Za-z0-9_-]{43})$/;
const actions = new Set([
  'list', 'context', 'inventory', 'tasks', 'spells', 'receipt', 'inbox',
  'walk', 'follow', 'stay', 'stop', 'sit', 'task', 'equip', 'cast', 'speak', 'ack',
]);
const fields = {
  identity: ['operation'],
  bind: ['operation', 'ownerId', 'maidId', 'controllerId'],
  release: ['operation', 'ownerId', 'maidId', 'controllerId', 'generation'],
  call: ['operation', 'ownerId', 'maidId', 'controllerId', 'generation', 'name', 'arguments', 'requestId'],
};

class Fault extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUuid = value => typeof value === 'string' && uuid.test(value);
const isGeneration = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const digest = value => createHash('sha256').update(value).digest('hex');

function httpsUrl(value, pathname) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== pathname || url.username || url.password
      || /[?#]/.test(url.href)) throw new Error('invalid HTTPS URL');
  return url;
}

async function postJson(target, agent, token, input, timeout, limit) {
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const payload = Buffer.from(JSON.stringify(input));
  const response = await new Promise((resolve, reject) => {
    const request = send(target, {
      method: 'POST', agent, signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
    }, resolve);
    request.once('error', reject);
    request.end(payload);
  });
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > limit) throw new Error('upstream reply too large');
    chunks.push(chunk);
  }
  return { status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
}

async function readGrants(path) {
  const document = JSON.parse(await readFile(path, 'utf8'));
  if (document.schema !== 1 || !Array.isArray(document.grants)) throw new Error('invalid grants');
  const grants = new Map();
  for (const row of document.grants) {
    const { keySha256, ownerId, maidId, expiresAt } = row;
    const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
    if (typeof keySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(keySha256)
        || grants.has(keySha256) || !isUuid(ownerId) || !isUuid(maidId) || !Number.isFinite(expiry)) {
      throw new Error('invalid grant');
    }
    grants.set(keySha256, { ownerId, maidId, expiry });
  }
  return grants;
}

async function readRequest(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new Fault(415, 'JSON_REQUIRED');
  }
  if (Number(request.headers['content-length']) > bodyLimit) throw new Fault(413, 'PAYLOAD_TOO_LARGE');
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > bodyLimit) throw new Fault(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new Fault(400, 'INVALID_JSON');
  }
  if (!isObject(input) || typeof input.operation !== 'string' || !Object.hasOwn(fields, input.operation)) {
    throw new Fault(400, 'INVALID_OPERATION');
  }
  if (Object.keys(input).some(field => !fields[input.operation].includes(field))) {
    throw new Fault(400, 'UNEXPECTED_FIELD');
  }
  return input;
}

function nativeController(keyHash, externalId) {
  // Separate grants for the same maid must identify different native leases.
  const bytes = Buffer.from(digest('maid-api-controller/v1:' + keyHash + ':' + externalId).slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function scopeRequest(input, grant, keyHash) {
  const { operation, controllerId, generation } = input;
  if (!isUuid(controllerId) || (operation !== 'bind' && !isGeneration(generation))) {
    throw new Fault(400, 'INVALID_CONTROLLER_OR_GENERATION');
  }
  const { ownerId, maidId } = grant;
  for (const source of [input, input.arguments]) {
    if (isObject(source) && (
      (Object.hasOwn(source, 'maidId') && source.maidId !== maidId)
      || (Object.hasOwn(source, 'ownerId') && source.ownerId !== ownerId)
    )) throw new Fault(403, 'BODY_MISMATCH');
  }
  const upstream = { operation, ownerId, maidId, controllerId: nativeController(keyHash, controllerId) };
  if (operation !== 'bind') upstream.generation = generation;
  if (operation === 'call') {
    if (input.name !== 'mc_maids' || !isObject(input.arguments)) throw new Fault(400, 'INVALID_TOOL');
    if (!actions.has(input.arguments.action)) throw new Fault(400, 'UNSUPPORTED_ACTION');
    const args = { ...input.arguments };
    delete args.ownerId; // The native port reads ownerId from its authenticated envelope.
    Object.assign(upstream, { name: input.name, arguments: args, requestId: input.requestId });
  }
  return upstream;
}

function narrowTools(envelope) {
  const tool = Array.isArray(envelope.tools) ? envelope.tools.find(item => item?.name === 'mc_maids') : null;
  const schema = tool?.inputSchema;
  const advertised = schema?.properties?.action?.enum;
  if (!Array.isArray(advertised) || !Array.isArray(schema.oneOf)) throw new Fault(502, 'INVALID_NATIVE_RESPONSE');
  const allowed = advertised.filter(action => actions.has(action));
  const branches = schema.oneOf.filter(branch => allowed.includes(branch?.properties?.action?.const));
  const keys = new Set(branches.flatMap(branch => branch.propertyNames?.enum ?? []));
  if (!['list', 'context', 'receipt'].every(action => allowed.includes(action)) || branches.length !== allowed.length) {
    throw new Fault(502, 'INVALID_NATIVE_RESPONSE');
  }
  schema.oneOf = branches;
  schema.properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => keys.has(key)));
  schema.properties.action = { type: 'string', enum: allowed };
  tool.description = 'One registered maid. Writes use an original requestId. Query receipt after an uncertain result.';
  envelope.tools = [tool];
}

function reply(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
    ...(status === 405 ? { Allow: 'POST' } : {}),
    ...(status === 413 ? { Connection: 'close' } : {}),
  });
  response.end(JSON.stringify(body));
}

export async function createMaidApi(settings) {
  const { schema, port, nativePort, nativeTokenFile, grantsFile, portalOrigin, publicEndpoint, portalCaFile } = settings;
  const validPort = number => Number.isInteger(number) && number >= 1024 && number <= 65_535;
  if (schema !== 1 || !validPort(port) || !validPort(nativePort) || port === nativePort
      || typeof nativeTokenFile !== 'string' || !isAbsolute(nativeTokenFile)
      || !grantsFile && !portalOrigin || grantsFile && (typeof grantsFile !== 'string' || !isAbsolute(grantsFile))
      || portalCaFile && (!portalOrigin || typeof portalCaFile !== 'string' || !isAbsolute(portalCaFile))) {
    throw new Error('invalid API settings');
  }
  const portal = portalOrigin ? new URL('/api/v1/maid-connect/check', httpsUrl(portalOrigin, '/')) : null;
  const audience = portal ? httpsUrl(publicEndpoint, route).href : null;
  const ca = portalCaFile ? await readFile(portalCaFile) : undefined;
  const nativeToken = (await readFile(nativeTokenFile, 'ascii')).trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(nativeToken)) throw new Error('invalid native token');
  const localGrants = () => grantsFile ? readGrants(grantsFile) : Promise.resolve(new Map());
  await localGrants();
  const leases = new Map();
  const nativeTarget = new URL('http://127.0.0.1:' + nativePort + '/maid-body');
  // Private agents use the configured hosts even if Node's global agent uses an environment proxy.
  const nativeAgent = new Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 2 });
  const portalAgent = portal ? new HttpsAgent({ keepAlive: true, maxSockets: 12, ca }) : null;

  async function sendNative(input) {
    let status, envelope;
    try {
      ({ status, data: envelope } = await postJson(nativeTarget, nativeAgent, nativeToken, input, 8_000, nativeReplyLimit));
    } catch {
      throw new Fault(502, 'NATIVE_RESULT_UNKNOWN');
    }
    if (status !== 200) {
      if ([400, 403, 409, 503].includes(status)
          && typeof envelope?.error === 'string' && /^[A-Za-z0-9_]{1,96}$/.test(envelope.error)) {
        throw new Fault(status, envelope.error);
      }
      throw new Fault(502, 'NATIVE_RESULT_UNKNOWN');
    }
    if (!isObject(envelope) || envelope.protocol !== protocol || !isGeneration(envelope.generation)
        || ['ownerId', 'maidId', 'controllerId'].some(field => input[field] !== envelope[field])
        || (input.generation && input.generation !== envelope.generation)) {
      throw new Fault(502, 'INVALID_NATIVE_RESPONSE');
    }
    return envelope;
  }

  async function websiteGrant(token) {
    if (!portal) return null;
    let status, data;
    try {
      ({ status, data } = await postJson(portal, portalAgent, token, {}, 4_000, 8_192));
    } catch {
      throw new Fault(503, 'MAID_PORTAL_UNAVAILABLE');
    }
    if ([202, 401, 403, 404].includes(status)) return null;
    if (status !== 200 || data?.state !== 'approved' || !isUuid(data.ownerId) || !isUuid(data.maidId)
        || !Number.isSafeInteger(data.expiresAt)) throw new Fault(503, 'MAID_PORTAL_UNAVAILABLE');
    if (data.bodyEndpoint !== audience || data.expiresAt <= Date.now()) return null;
    return { ownerId: data.ownerId, maidId: data.maidId, expiry: data.expiresAt };
  }

  async function authorize(keyHash, portalToken) {
    let grant;
    if (portalToken) {
      grant = await websiteGrant(portalToken);
    } else {
      try {
        grant = (await localGrants()).get(keyHash);
      } catch {
        throw new Fault(503, 'AUTHORIZATION_UNAVAILABLE');
      }
    }
    if (!grant || grant.expiry <= Date.now()) throw new Fault(401, 'UNAUTHORIZED');
    return grant;
  }

  async function handle(request, response) {
    try {
      if (request.url !== route) throw new Fault(404, 'NOT_FOUND');
      if (request.method !== 'POST') throw new Fault(405, 'POST_REQUIRED');
      const token = keyPattern.exec(request.headers.authorization ?? '')?.[1];
      if (!token) throw new Fault(401, 'UNAUTHORIZED');
      const input = await readRequest(request);
      const keyHash = digest(token);
      const portalToken = token.startsWith('mdw_') ? token : null;
      const grant = await authorize(keyHash, portalToken);
      if (input.operation === 'identity') {
        reply(response, 200, { protocol, ownerId: grant.ownerId, maidId: grant.maidId });
        return;
      }
      const upstream = scopeRequest(input, grant, keyHash);
      const envelope = await sendNative(upstream);
      const { generation, ownerId, maidId, controllerId } = envelope;
      const leaseId = maidId + ':' + generation;
      if (input.operation === 'release') {
        leases.delete(leaseId);
      } else {
        const lease = {
          native: { operation: 'release', ownerId, maidId, controllerId, generation },
          keyHash, portalToken, until: Date.now() + leaseMs, nextCheck: Date.now() + 3_000,
        };
        leases.set(leaseId, lease);
        if (input.operation === 'bind') {
          try {
            narrowTools(envelope);
          } catch (error) {
            await releaseLease(leaseId, lease);
            throw error;
          }
        }
      }
      reply(response, 200, { ...envelope, controllerId: input.controllerId });
    } catch (error) {
      const fault = error instanceof Fault ? error : new Fault(503, 'API_UNAVAILABLE');
      if (!response.destroyed && !response.headersSent) {
        reply(response, fault.status, { protocol, error: fault.message, retryAllowed: false });
      }
    }
  }

  async function releaseLease(leaseId, lease) {
    try {
      await sendNative(lease.native);
    } catch (error) {
      if (error.status !== 403 && !['CONTROL_CHANGED', 'CONTROL_EXPIRED'].includes(error.message)) return;
    }
    leases.delete(leaseId);
  }

  async function retire(grants, shutdown = false) {
    const now = Date.now();
    await Promise.all([...leases].map(async ([leaseId, lease]) => {
      if (lease.until <= now) {
        leases.delete(leaseId);
        return;
      }
      let grant;
      if (!shutdown && lease.portalToken) {
        if (lease.nextCheck > now) return;
        lease.nextCheck = now + 3_000;
        try {
          grant = await websiteGrant(lease.portalToken);
        } catch {
          return; // During a portal outage, keep the native expiration as the fallback.
        }
      } else {
        grant = grants.get(lease.keyHash);
      }
      if (!grant || grant.expiry <= now || grant.maidId !== lease.native.maidId || grant.ownerId !== lease.native.ownerId) {
        await releaseLease(leaseId, lease);
      }
    }));
  }

  const server = createServer({
    headersTimeout: 5_000, requestTimeout: 10_000, connectionsCheckingInterval: 1_000, maxHeaderSize: 8_192,
  }, handle);
  server.maxConnections = 32;
  let sweep;
  const timer = setInterval(() => {
    sweep ??= localGrants().catch(() => new Map()).then(retire).finally(() => { sweep = null; });
  }, 1_000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return {
    server,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await sweep;
      await retire(new Map(), true);
      nativeAgent.destroy();
      portalAgent?.destroy();
    },
  };
}

async function main() {
  const [configOrIssue, keyFile, extra] = process.argv.slice(2);
  if (configOrIssue === 'issue' && keyFile && isAbsolute(keyFile) && !extra) {
    const key = 'mda_' + randomBytes(32).toString('base64url');
    await writeFile(keyFile, key + '\n', { flag: 'wx', mode: 0o600 });
    console.log(digest(key));
    return;
  }
  if (!configOrIssue || !isAbsolute(configOrIssue) || keyFile) {
    throw new Error('usage: node maid-api.mjs <absolute-config-path> | issue <absolute-key-file>');
  }
  const settings = JSON.parse(await readFile(configOrIssue, 'utf8'));
  const api = await createMaidApi(settings);
  await new Promise((resolve, reject) => {
    api.server.once('error', reject);
    api.server.listen(settings.port, '127.0.0.1', resolve);
  });
  console.log('Maid API listening on loopback port ' + settings.port);
  const stop = async () => {
    await api.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    // Keep the service log free of credentials and user input.
    console.error('Maid API startup failed (' + (error.code ?? error.name) + ')');
    process.exitCode = 1;
  });
}
