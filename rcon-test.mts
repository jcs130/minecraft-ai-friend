// RCON test driver for passive E2E test: node via tsx — rcon-test.mts <cmd...>
import { readFileSync } from 'node:fs'
import { argv, exit } from 'node:process'
import { Rcon } from './src/rcon.ts'

const secret = readFileSync('./data/rcon-secret.txt', 'utf-8').trim()
const rcon = new Rcon('127.0.0.1', 25575, secret)
await rcon.connect()
for (const cmd of argv.slice(2)) {
  const out = await rcon.send(cmd)
  console.log(`> ${cmd}\n${out}`)
}
rcon.close()
exit(0)
