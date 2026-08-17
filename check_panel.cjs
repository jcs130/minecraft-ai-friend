// 提取 web-panel 页面的浏览器端 <script> 并做语法校验
const fs = require('fs');
const http = require('http');

http.get('http://127.0.0.1:9090/', (res) => {
  let html = '';
  res.on('data', (c) => { html += c; });
  res.on('end', () => {
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) { console.error('FAIL: no script block, len=' + html.length); process.exit(1); }
    const tmp = process.env.TEMP + '\\panel_check.js';
    fs.writeFileSync(tmp, m[1], 'utf8');
    console.log('extracted ' + m[1].length + ' chars -> ' + tmp);
    // 快速检查修复点是否生效
    const hasBug = m[1].includes("window.open('/shot/'");
    const hasFix = m[1].includes('data-shot');
    console.log('inline-onclick-bug-present=' + hasBug + ' data-shot-fix-present=' + hasFix);
  });
}).on('error', (e) => { console.error('FAIL: ' + e.message); process.exit(1); });
