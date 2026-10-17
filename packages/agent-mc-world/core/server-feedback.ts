import type { ProtectReply } from './protection-port.ts';

/** A direct server result, not a server-specific channel or region decoder.
 * Call only after excluding player chat/quotes. Conflicting or incomplete
 * claims stay text evidence; they cannot grant permissions or create an ACL.
 */
export function parseServerActionDenial(text: string): ProtectReply | null {
  if (text.length > 32768) return null;
  const start=text.indexOf('{');
  if (start<0 || !/^(?:[\w:.-]+\s+)?$/.test(text.slice(0,start))) return null;
  let value: Record<string, unknown>;
  try { value=JSON.parse(text.slice(start)); } catch { return null; }
  if (!value || Array.isArray(value) || value.status!=='deny' || value.allowed!==false
    || !['break','place'].includes(String(value.action))) return null;
  const dimension=value.dimension ?? value.world;
  if (typeof dimension!=='string' || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]{1,128}$/.test(dimension)
    || (typeof value.dimension==='string' && typeof value.world==='string'
      && value.dimension.replace(/^minecraft:/,'')!==value.world.replace(/^minecraft:/,''))
    || ![value.x,value.y,value.z].every(n=>typeof n==='number' && Number.isSafeInteger(n) && Math.abs(n)<=30_000_000)) return null;
  return { action:value.action as 'break'|'place', dimension:dimension.replace(/^minecraft:/,''),
    x:value.x as number,y:value.y as number,z:value.z as number,status:'deny',
    reason:typeof value.reason==='string'?value.reason.slice(0,512):'server denied this action' };
}

/** Historical server error observations, never permissions or proof of effects. */
export class ServerFeedbackLedger {
  private rows: Array<{ text: string; channel: string; receivedAt: string; taskId: number | null; at: number }> = [];

  note(text: string, channel: string, taskId: number | null, now = Date.now()): boolean {
    text = text.trim();
    if (text.length > 8000) text = text.slice(0, 7900) + '…[完整原文见服务端消息事件归档]';
    // Generic language / structured result conventions only. Server-specific
    // channel decoding and ACL policy remain in optional extension ports.
    if (!text || !/(?:denied|not allowed|no permission|don't have permission|cannot|can't|failed|error|invalid|too far|not enough|缺少|不足|失败|错误|无效|不能|无法|不允许|没有权限|无权|禁止|拒绝|未授权|太远|受保护|保护区)|"(?:allowed|success|ok)"\s*:\s*false|"status"\s*:\s*"(?:deny|error|failed)"/i.test(text)) return false;
    this.rows = this.rows.filter(row => now - row.at < 600_000);
    const same = this.rows.find(row => row.text === text);
    if (same) { same.at = now; same.taskId = taskId; return false; }
    this.rows.push({ text: text.slice(0, 8000), channel, receivedAt: new Date(now).toISOString(), taskId, at: now });
    this.rows = this.rows.slice(-3);
    return true;
  }

  clear(): void { this.rows = []; }

  forTask(taskId: number, now = Date.now()): string {
    const rows = this.rows.filter(row => row.taskId === taskId && now - row.at < 600_000);
    return rows.length ? '\n[任务期间的服务端原话；仅时间/任务关联，不自动认定因果]\n'
      + rows.map(row => row.text).join('\n') : '';
  }

  read(now = Date.now()): string | null {
    const rows = this.rows.filter(row => now - row.at < 600_000);
    if (!rows.length) return null;
    return '最近服务端拒绝/错误原话（历史反馈，不是当前权限或动作成功证明；不要因后续查询完成而忽略它）：\n'
      + JSON.stringify(rows.slice().reverse().map(({ at: _at, ...row }) => row));
  }
}
