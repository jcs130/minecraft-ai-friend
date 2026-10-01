import {createHash} from 'node:crypto';
import {copyFileSync, readFileSync, writeFileSync} from 'node:fs';

// Run only while the isolated 25566 server is stopped; never point this at production.
const path = 'E:/MC/staging/arena-dungeon-20260928/plugins/AgentFriend/config.yml';
const [lowName, highName] = process.argv.slice(2);
if (!lowName || !highName || lowName === highName) throw new Error('Provide two distinct test names');
const offlineUuid = name => {
  const bytes = createHash('md5').update(`OfflinePlayer:${name}`).digest();
  bytes[6] = bytes[6] & 0x0f | 0x30;
  bytes[8] = bytes[8] & 0x3f | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const low = offlineUuid(lowName), high = offlineUuid(highName);
let config = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
if (config.includes(low) || config.includes(high)) throw new Error('Use fresh test names');
if (!/^guild-players:[ \t]*$/m.test(config) || !/^dungeon-daily-claims:[ \t]*$/m.test(config))
  throw new Error('Stage config structure changed');
const backup = `${path}.level-qa-${Date.now()}.bak`;
copyFileSync(path, backup);
config = config.replace(/^guild-players:[ \t]*$/m,
  `guild-players:\n  ${low}:\n    joined: '2026-10-02'\n    fame: 0\n  ${high}:\n    joined: '2026-10-02'\n    fame: 150`);
config = config.replace(/^dungeon-daily-claims:[ \t]*$/m,
  `dungeon-daily-claims:\n  ${high}:\n    '1': 0\n    '2': 0\n    '3': 0\n    '4': 0`);
config = config.replace(/^dungeon-last-run: \d+[ \t]*$/m, 'dungeon-last-run: 0');
config = config.replace(/^dungeon-active-run:[ \t]*\n(?:^[ \t].*\n)*/m, '');
writeFileSync(path, config, 'utf8');
console.log(JSON.stringify({lowName, low, highName, high, backup}));
