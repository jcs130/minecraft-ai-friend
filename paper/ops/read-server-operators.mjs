import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/** Read Paper's operator list without issuing a game command.
 * `/op <name>` grants operator rights. In particular, `/op list` is NOT a query:
 * it makes the account named "list" an operator and can trip the login guard.
 * Operational checks must read this file or use a player's native isOp getter. */
export function readServerOperators(serverRoot) {
  const rows=JSON.parse(readFileSync(join(serverRoot,'ops.json'),'utf8'));
  if(!Array.isArray(rows)||rows.some(row=>!row||typeof row.name!=='string'||!row.name||typeof row.uuid!=='string'))throw new Error('Invalid operator registry');
  return rows.map(row=>({...row}));
}
export function isServerOperator(serverRoot,name) {
  if(typeof name!=='string'||!name)throw new Error('Invalid player name');
  return readServerOperators(serverRoot).some(row=>row.name.toLowerCase()===name.toLowerCase());
}
