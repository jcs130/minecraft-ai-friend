import { TaskMonitor } from './task-monitor.mjs'
const flag = process.argv.indexOf('--directory')
if (flag < 0 || !process.argv[flag + 1]) throw Error('Usage: node task-report.mjs --directory <absolute task-monitor directory>')
const monitor = new TaskMonitor({ directory: process.argv[flag + 1], readOnly: true })
const report = monitor.report()
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.health.ok ? 0 : 1
