import { readFileSync } from 'node:fs';
import { signCharacterHistory, verifyCharacterHistory } from '../src/character-history.mjs';

const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const key = path => readFileSync(path);
const [command, ...args] = process.argv.slice(2);

try {
  let result;
  if (command === 'sign' && args.length === 3) {
    result = signCharacterHistory(json(args[0]), json(args[1]), key(args[2]));
  } else if (command === 'verify' && args.length === 2) {
    result = verifyCharacterHistory(json(args[0]), key(args[1]));
  } else {
    throw new Error('Usage: character-history.mjs sign PLAN VERIFIED_PROOFS PRIVATE_KEY | verify ENVELOPE PUBLIC_KEY');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write((error instanceof TypeError ? error.message : 'Unable to read character history inputs') + '\n');
  process.exitCode = 1;
}
