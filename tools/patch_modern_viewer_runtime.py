"""Apply guarded viewer runtime fixes; no asset generation or service operations.

The readable runtime module is embedded immediately after the existing budget
prelude, because the deployed viewer intentionally serves a fixed asset allowlist.
Unknown bundle anchors fail before any file is written. Reapplying is idempotent.
"""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / 'vendor/modern-viewer/modern-viewer.js'
MODULE = ROOT / 'vendor/modern-viewer/runtime-budget.js'
PRELUDE = '/* QIANDENG_RENDER_BUDGET_V1 */\nif(typeof document!=="undefined")document.documentElement.dataset.qdDiagnostic=String(new URLSearchParams(location.search).has("diagnostic"));\n'
BEGIN = '/* QIANDENG_VIEWER_RUNTIME_V2_BEGIN */\n'
END = '/* QIANDENG_VIEWER_RUNTIME_V2_END */\n'


def once(data, before, after):
    if data.count(after) == 1:
        return data
    if data.count(before) != 1:
        raise ValueError('Unexpected viewer anchor; refusing an unverified patch')
    return data.replace(before, after, 1)


def patch(data, module):
    if not data.startswith(PRELUDE):
        raise ValueError('Existing worker/distance/render-budget prelude is required')
    if BEGIN in data:
        start, end = data.index(BEGIN), data.index(END) + len(END)
        if data.count(BEGIN) != 1 or data.count(END) != 1 or start != len(PRELUDE):
            raise ValueError('Unexpected embedded runtime boundary')
        data = data[:start] + data[end:]
    replacements = [
        ('callbacks:{displayCriticalError:r=>{},',
         'callbacks:{displayCriticalError:r=>{console.error("Modern renderer backend failure",r);hHe(r)},'),
        ('fetch(UCe,{cache:"reload"}),fetch(jCe,{cache:"reload"})',
         'fetch(UCe,{cache:"reload",signal:AbortSignal.timeout(30000)}),fetch(jCe,{cache:"reload",signal:AbortSignal.timeout(30000)})'),
        ('maximumPixelRatio:1.75,preference:y4', 'maximumPixelRatio:1,preference:y4'),
        ('n=Gh(t.lowFpsThreshold,20,58,44),s=Math.max(n+2,Gh(t.recoveryFpsThreshold,30,60,55))',
         'n=Gh(t.lowFpsThreshold,20,28,23),s=Math.max(n+2,Gh(t.recoveryFpsThreshold,23,30,28))'),
        ('this.updatePosDataChunk(e.key),o&&this.getModule("futuristicReveal")',
         'this.updatePosDataChunk(e.key),o&&globalThis.__qdViewerRuntime.markGeometry(),o&&this.getModule("futuristicReveal")'),
        ('async function Uje(t){tC=!0,', 'async function Uje(t){globalThis.__qdViewerRuntime.stage("loading-assets");tC=!0,'),
        ('let a=await Noe();if(a&&Boe(e,a),await e.updateAssetsData({})',
         'let a=await Noe();globalThis.__qdViewerRuntime.assetsLoaded(!!a);if(a&&Boe(e,a),await e.updateAssetsData({})'),
        ('let o=1;ja=new ire(', 'globalThis.__qdViewerRuntime.stage("starting-backend");let o=1;ja=new ire('),
        ('function hHe(t){let e=', 'function hHe(t){globalThis.__qdViewerRuntime.fail();let e='),
        ('function v5(t,e=!1,a=!1){a&&!e',
         'function v5(t,e=!1,a=!1){if(a&&!e&&globalThis.__qdViewerRuntime&&!globalThis.__qdViewerRuntime.sceneReady){const r=t;globalThis.__qdViewerRuntime.deferReady(()=>v5(r,!1,!0));t="正在生成世界区块…";a=!1}a&&!e'),
    ]
    for before, after in replacements:
        data = once(data, before, after)
    signature = 'async processMessageQueue(e){'
    replacement = signature + 'return globalThis.__qdViewerRuntime.drainMesherQueue(this)}'
    if replacement not in data:
        start = data.index(signature)
        end = data.index('handleMessage(e){', start)
        original = data[start:end]
        if len(original) > 1500 or 'this.ONMESSAGE_TIME_LIMIT' not in original or 'requestAnimationFrame' not in original:
            raise ValueError('Unexpected mesher queue implementation')
        data = data[:start] + replacement + data[end:]
    data = PRELUDE + BEGIN + module.rstrip() + '\n' + END + data[len(PRELUDE):]
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    before = VIEWER.read_bytes()
    result = patch(before.decode('utf8'), MODULE.read_text(encoding='utf8')).encode('utf8')
    if args.check and before != result:
        raise SystemExit('Viewer runtime patch is not current')
    if not args.check and before != result:
        VIEWER.write_bytes(result)
    print(json.dumps({'changed': before != result, 'check': args.check,
                      'beforeSha256': hashlib.sha256(before).hexdigest(),
                      'sha256': hashlib.sha256(result).hexdigest(),
                      'moduleSha256': hashlib.sha256(MODULE.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
