import {readFileSync, writeFileSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

export function validateSecret(bytes, kind = 'password') {
  const text = bytes.toString('utf8').replace(/\r?\n$/, '');
  if (kind === 'portal' ? !/^pat_[A-Za-z0-9_-]{43}$/.test(text)
    : !text || text.length > 128 || /\s|[\x00-\x1f]/.test(text)) throw Error('invalid_private_credential');
  return Buffer.from(text, 'utf8');
}
export function readPlain(file, kind = 'password') {
  const stat = statSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 16384 || (process.platform !== 'win32' && (stat.mode & 0o077))) throw Error('private_credential_permissions');
  const raw = readFileSync(file);
  try { return validateSecret(raw, kind); } finally { raw.fill(0); }
}
function dpapi(bytes, protect) {
  if (process.platform !== 'win32') throw Error('dpapi_requires_original_windows_user');
  const method = protect ? 'Protect' : 'Unprotect';
  const script = `Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); try {$resultBytes=[Security.Cryptography.ProtectedData]::${method}($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); try {[Convert]::ToBase64String($resultBytes)} finally {[Array]::Clear($resultBytes,0,$resultBytes.Length)}} finally {[Array]::Clear($inputBytes,0,$inputBytes.Length)}`;
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script],
      {input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536,stdio:['pipe','pipe','pipe']});
    return Buffer.from(output.trim(), 'base64');
  } catch { throw Error('private_credential_unavailable'); }
}
export function saveSecret(file, bytes, format = process.platform === 'win32' ? 'dpapi' : 'file') {
  if (!['dpapi','file'].includes(format)) throw Error('unsupported_private_credential_format');
  const protectedBytes = format === 'dpapi' ? dpapi(bytes, true) : Buffer.from(bytes);
  try { writeFileSync(file, protectedBytes, {mode:0o600,flag:'wx'}); } finally { protectedBytes.fill(0); }
  return format;
}
export function readSecret(file, format, kind = 'password') {
  if (format === 'file') return readPlain(file, kind);
  if (format !== 'dpapi') throw Error('unsupported_private_credential_format');
  const stat = statSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 16384) throw Error('invalid_private_credential_file');
  const raw = readFileSync(file);
  if (!raw.length || raw.length > 16384) throw Error('invalid_private_credential_file');
  let plain;
  try { plain = dpapi(raw, false); return validateSecret(plain, kind); }
  finally { raw.fill(0); plain?.fill(0); }
}
