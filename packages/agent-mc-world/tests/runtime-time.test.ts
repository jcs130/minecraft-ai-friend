import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { nowIso } from '../core/support/runtime.mjs';

describe('upstream clock compatibility', () => {
  it('preserves the instant and milliseconds with non-integral hour offsets', () => {
    const instant = new Date('2026-10-14T00:32:31.481Z');
    const rendered = nowIso('Asia/Kathmandu', instant);
    expect(rendered).toBe('2026-10-14T06:17:31.481+05:45');
    expect(Date.parse(rendered)).toBe(instant.getTime());
  });
  it.each(['America/New_York', 'Europe/Berlin'])('is independent of process daylight saving in %s', timezone => {
    const moduleUrl = new URL('../core/support/runtime.mjs', import.meta.url).href;
    const code = `import { nowIso, SYSTEM_TIMEZONE } from ${JSON.stringify(moduleUrl)};
      const dates = ['2026-03-08T06:30:00.125Z','2026-03-08T07:30:00.125Z','2026-11-01T05:30:00.125Z','2026-11-01T06:30:00.125Z'];
      console.log(JSON.stringify({ zone: SYSTEM_TIMEZONE, rows: dates.map(s => [s, nowIso('America/New_York',new Date(s)),nowIso('Asia/Shanghai',new Date(s))]) }));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 10000,
    }));
    expect(result.zone).toBe(timezone);
    for (const [source, newYork, shanghai] of result.rows) {
      expect(Date.parse(newYork)).toBe(Date.parse(source));
      expect(Date.parse(shanghai)).toBe(Date.parse(source));
    }
    expect(result.rows[0][1]).toBe('2026-03-08T01:30:00.125-05:00');
    expect(result.rows[1][1]).toBe('2026-03-08T03:30:00.125-04:00');
  });
});
