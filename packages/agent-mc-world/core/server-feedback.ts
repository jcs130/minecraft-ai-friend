/** Historical server error observations, never permissions or proof of effects. */
export class ServerFeedbackLedger {
  private rows: Array<{ text: string; channel: string; receivedAt: string; taskId: number | null; at: number }> = [];

  note(text: string, channel: string, taskId: number | null, now = Date.now()): boolean {
    text = text.trim();
    if (text.length > 8000) text = text.slice(0, 7900) + '…[完整原文见服务端消息事件归档]';
    // Generic language / structured result conventions only. Server-specific
    // channel decoding and ACL policy remain in optional extension ports.
    if (!text || !/(?:denied|not allowed|cannot|can't|failed|error|invalid|too far|not enough|缺少|不足|失败|错误|无效|不能|无法|不允许|拒绝|未授权|太远|受保护|保护区)|"(?:allowed|success|ok)"\s*:\s*false|"status"\s*:\s*"(?:deny|error|failed)"/i.test(text)) return false;
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
