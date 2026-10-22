import { inflateRawSync, inflateSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const MAX_APPEARANCE_BYTES = 8 * 1024 * 1024;
const fail = (reason, message) => Object.assign(Error(message), { status: 400, reason });
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
export function crc32(bytes) { let n = 0xffffffff; for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; }
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function modelSourceHash(files) { const hash = createHash('sha256'); for (const [name, raw] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) { hash.update(name); hash.update(Buffer.from([0])); hash.update(createHash('sha256').update(raw).digest()); } return hash.digest('hex'); }
const safePath = name => name.length > 0 && name.length <= 200 && !/[\\:\x00-\x1f]/.test(name) && !name.startsWith('/') && name.split('/').every(part => part !== '..' && part !== '.');

export function pngInfo(bytes, skin = false) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || bytes.length > (skin ? 128 * 1024 : MAX_APPEARANCE_BYTES) || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw fail('PNG_REQUIRED', '请上传有效的 PNG 图片');
  let offset = 8, header, ended = false, dataSeen = false; const data = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
    if (end > bytes.length) throw fail('PNG_INVALID', 'PNG 文件不完整');
    const type = bytes.toString('ascii', offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw fail('PNG_INVALID', 'PNG 校验不正确');
    if (!header && type !== 'IHDR') throw fail('PNG_INVALID', 'PNG 缺少图像头');
    if (type === 'IHDR') {
      if (header || size !== 13) throw fail('PNG_INVALID', 'PNG 图像头不正确');
      header = { width: chunk.readUInt32BE(0), height: chunk.readUInt32BE(4), depth: chunk[8], color: chunk[9], compression: chunk[10], filter: chunk[11], interlace: chunk[12] };
      if (!header.width || !header.height || header.width > 2048 || header.height > 2048 || header.depth !== 8 || ![2, 6].includes(header.color) || header.compression || header.filter || header.interlace) throw fail('PNG_FORMAT_UNSUPPORTED', '请导出 8 位 RGB 或 RGBA、无交错的 PNG 图片');
      if (skin && (header.width !== 64 || ![32, 64].includes(header.height))) throw fail('SKIN_DIMENSIONS', '普通皮肤需为 64×64 或 64×32 PNG；设定图和 YSM 请使用各自入口');
    } else if (type === 'IDAT') { data.push(chunk); dataSeen = true; }
    else if (type === 'IEND') { if (size || !dataSeen || end !== bytes.length) throw fail('PNG_INVALID', 'PNG 图片结尾不正确'); ended = true; break; }
    else if (/^[A-Z]/.test(type)) throw fail('PNG_FORMAT_UNSUPPORTED', '请导出普通 RGB/RGBA PNG 图片');
    offset = end;
  }
  if (!header || !ended) throw fail('PNG_INVALID', 'PNG 文件不完整');
  const stride = header.width * (header.color === 6 ? 4 : 3) + 1, expected = stride * header.height;
  let raw; try { raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected }); } catch { throw fail('PNG_INVALID', 'PNG 像素数据不正确'); }
  if (raw.length !== expected) throw fail('PNG_INVALID', 'PNG 像素数据长度不正确');
  for (let i = 0; i < raw.length; i += stride) if (raw[i] > 4) throw fail('PNG_INVALID', 'PNG 像素过滤无效');
  return { width: header.width, height: header.height, sha256: sha(bytes) };
}

// Read bounded entries into memory, never extract uploader-controlled paths.
// ZIP64, encryption, links, duplicate paths and executable content are refused.
export function ysmArchive(bytes, { includeFiles = false } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_APPEARANCE_BYTES) throw fail('YSM_ARCHIVE_SIZE', 'YSM 需为 8MB 以内的原始公开模型 ZIP');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw fail('YSM_ZIP_INVALID', '请上传完整的单卷 ZIP，不能使用加密 .ysm 文件');
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12); let at = bytes.readUInt32LE(end + 16);
  if (!count || count > 128 || count !== bytes.readUInt16LE(end + 8) || at + directorySize !== end) throw fail('YSM_ZIP_BUDGET', '模型 ZIP 最多 128 个文件，且不支持 ZIP64');
  let total = 0; const files = new Map(), names = new Set();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw fail('YSM_ZIP_INVALID', 'ZIP 目录不正确');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10), crc = bytes.readUInt32LE(at + 16), compressed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24), nameLength = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42), mode = bytes.readUInt32LE(at + 38) >>> 16;
    if (at + 46 + nameLength + extra + comment > end) throw fail('YSM_ZIP_INVALID', 'ZIP 目录越界');
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    if (!safePath(name) || names.has(name.toLowerCase()) || (mode & 0xf000) === 0xa000 || flags & 1 || ![0, 8].includes(method)) throw fail('YSM_ZIP_PATH', 'ZIP 不能含重复路径、链接、加密或不安全文件名');
    names.add(name.toLowerCase());
    if (local + 30 > at || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 6) !== flags) throw fail('YSM_ZIP_INVALID', 'ZIP 文件头不正确');
    const localNameLength = bytes.readUInt16LE(local + 26), start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    if (bytes.toString('utf8', local + 30, local + 30 + localNameLength) !== name || start + compressed > at || (total += size) > MAX_APPEARANCE_BYTES || size > 4 * 1024 * 1024) throw fail('YSM_ZIP_BUDGET', '模型解压后最多 8MB，单文件最多 4MB');
    if (!name.endsWith('/')) {
      if (!/\.(json|png|ogg)$/i.test(name)) throw fail('YSM_FILE_TYPE', '模型仅接收 JSON、PNG 和 OGG 原始资源，不能包含程序或加密模型');
      let raw; try { raw = method === 0 ? bytes.subarray(start, start + compressed) : inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: Math.min(size + 1, MAX_APPEARANCE_BYTES) }); } catch { throw fail('YSM_ZIP_INVALID', '模型文件解压失败'); }
      if (raw.length !== size || crc32(raw) !== crc) throw fail('YSM_ZIP_INVALID', '模型文件校验失败');
      files.set(name, raw);
    }
    at += 46 + nameLength + extra + comment;
  }
  if (at !== end) throw fail('YSM_ZIP_INVALID', 'ZIP 目录长度不正确');
  const definitions = [...files.keys()].filter(name => name === 'ysm.json' || name.endsWith('/ysm.json'));
  if (definitions.length !== 1) throw fail('YSM_DEFINITION', 'ZIP 需要且只能包含一个 ysm.json 模型定义');
  const prefix = definitions[0].slice(0, -8), selected = new Map();
  for (const [name, raw] of files) { if (!name.startsWith(prefix)) throw fail('YSM_EXTRA_MODEL', '请只打包这一个模型目录'); selected.set(name.slice(prefix.length), raw); }
  const json = file => { try { const value = JSON.parse(selected.get(file).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw fail('YSM_JSON_INVALID', '模型 JSON 缺失或无效'); } };
  const spec = json('ysm.json');
  if (spec.spec !== 2 || spec.properties?.free !== true) throw fail('YSM_PUBLIC_PERMISSION', '仅支持 spec:2、properties.free:true 的公开源模型；加密模型请向作者索取可分发源文件');
  const requireFile = (file, type) => { if (typeof file !== 'string' || !safePath(file) || !file.toLowerCase().endsWith(type) || !selected.has(file)) throw fail('YSM_REFERENCE_MISSING', '模型引用的资源缺失或路径无效'); return file; };
  const player = spec.files?.player;
  if (!player || typeof player !== 'object') throw fail('YSM_PLAYER_MISSING', '模型定义缺少玩家资源');
  requireFile(player.model?.arm, '.json');
  const geometry = json(requireFile(player.model?.main, '.json'))['minecraft:geometry'];
  if (!Array.isArray(geometry) || !geometry.length || geometry.length > 8 || geometry.some(item => !Array.isArray(item.bones) || item.bones.length > 512)) throw fail('YSM_GEOMETRY', '模型需要有效的 Bedrock 玩家骨骼，最多 512 个骨骼');
  if (!json(requireFile(player.animation?.main, '.json')).animations) throw fail('YSM_ANIMATIONS', '模型需要有效的动画定义');
  for (const file of Object.values(player.model || {})) json(requireFile(file, '.json'));
  for (const file of Object.values(player.animation || {})) json(requireFile(file, '.json'));
  if (player.animation_controllers !== undefined && (!Array.isArray(player.animation_controllers) || player.animation_controllers.length > 8)) throw fail('YSM_CONTROLLERS', '动画控制器最多 8 个');
  for (const file of player.animation_controllers || []) json(requireFile(file, '.json'));
  if (!Array.isArray(player.texture) || !player.texture.length || player.texture.length > 16) throw fail('YSM_TEXTURES', '模型需有 1–16 张贴图');
  const textures = player.texture.map(file => { requireFile(file, '.png'); const dimensions = pngInfo(selected.get(file)); const name = file.split('/').at(-1).replace(/\.png$/i, ''); if (!/^[A-Za-z0-9_.-]{1,96}$/.test(name)) throw fail('YSM_TEXTURE_NAME', '贴图文件名请使用英文字母、数字、点、下划线或短横线'); return { name, ...dimensions }; });
  if (new Set(textures.map(row => row.name)).size !== textures.length) throw fail('YSM_TEXTURES', '模型贴图名称重复');
  // The existing Java converter exports base64 inside a gzip bundle. Check a
  // conservative envelope before installing, so a large source cannot make
  // the shared catalog exceed its 8MiB / 2MiB browser-resource limits.
  const bundle = Buffer.from(JSON.stringify({ files: Object.fromEntries([...selected].map(([name, raw]) => [name, { base64: raw.toString('base64'), sha256: sha(raw), bytes: raw.length }])) }));
  if (bundle.length + 32768 > 8 * 1024 * 1024 || gzipSync(bundle).length + 32768 > 2 * 1024 * 1024) throw fail('YSM_WEB_BUDGET', '模型超出当前 Web 转换资源预算，请精简贴图或无关文件后重试');
  return { sha256: sha(bytes), sourceSha256: modelSourceHash(selected), textures, webConvertible: true, javaRequiresYsm: true, bedrock: '部分投影支持，以实际游戏回执为准', ...(includeFiles ? { files: selected } : {}) };
}
