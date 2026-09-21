"""Read-only HTTP contracts for the decision canvas; no browser or agent actions."""
import json
import urllib.request


def probe():
    checks = {}
    try:
        content_types = {}

        def get(route):
            with urllib.request.urlopen('http://127.0.0.1:19091' + route, timeout=10) as response:
                content_types[route] = response.headers.get_content_type()
                return response.read(2 * 1024 * 1024).decode('utf-8')

        page = get('/observatory')
        app = get('/observatory.js')
        style = get('/observatory.css')
        model = get('/decision-model.js')
        canvas = get('/decision-canvas.js')
        motion = get('/observatory-motion.css')
        architecture = get('/embodied-architecture.js')
        checks['embodied-architecture'] = (all(x in page for x in ('id="architecture-canvas"', 'data-layer="online"', 'data-layer="l2"', 'data-layer="l3"'))
            and all(x in architecture for x in ('SYSTEM 1', 'SYSTEM 2', 'Dream', 'MCP', 'verifiedImprovement:null')))
        checks['world-first-layout'] = ('class="broadcast-stage"' in page and '观察者镜头' in page
            and "params.get('camera')==='off'?'off':'third'" in app)
        checks['mechanism-motion'] = ('architectureState' in app and 'architecture-flow' in style
            and 'prefers-reduced-motion:reduce' in style and "evidence: 'mechanism'" in architecture)
        checks['broadcast-page'] = all(x in page for x in (
            'id="decision-canvas"', 'id="graph-viewport"', 'id="node-detail"',
            'id="history-list"', 'id="world-frame"'))
        checks['broadcast-assets'] = ('type="module"' in page
            and all(x in app for x in ('./decision-model.js', './decision-canvas.js'))
            and '/observatory-motion.css' in style)
        checks['graph-module-contracts'] = (all(x in model for x in (
            'export function listDecisionRecords', 'export function buildDecisionGraph',
            'export function buildEvolutionGraph'))
            and 'export function renderDecisionCanvas' in canvas
            and all(content_types.get(route) in ('text/javascript', 'application/javascript')
                for route in ('/observatory.js', '/decision-model.js', '/decision-canvas.js'))
            and all(content_types.get(route) == 'text/css'
                for route in ('/observatory.css', '/observatory-motion.css')))
        checks['decision-views'] = all(f'data-view="{view}"' in page for view in ('policy', 'llm', 'rsi'))
        checks['playback-controls'] = all(f'id="{control}"' in page
            for control in ('play', 'step', 'speed', 'pause', 'playback-progress', 'playback-note'))
        checks['layer-inspection'] = (all(f'data-inspect="{layer}"' in page for layer in ('l1', 'l2', 'l3'))
            and all(f'id="{count}"' in page for count in ('action-count', 'skill-count', 'case-count')))
        checks['sidebar-canvas'] = 'mode-sidebar' in app and '.mode-sidebar .graph-viewport' in style
        checks['motion-accessibility'] = all(x in motion.replace(' ', '') for x in (
            'prefers-reduced-motion:no-preference', 'prefers-reduced-motion:reduce',
            '.edge.flowing', '.edge-signal', 'animation:none'))
        trace = json.loads(get('/api/survivor-trace'))
        rsi = json.loads(get('/api/rsi-observatory'))
        checks['trace-contract'] = trace.get('schema') == 1 and isinstance(trace.get('turns'), list)
        checks['trace-live-source'] = trace.get('available') is True and trace.get('stale') is False
        checks['decision-branches'] = ('id="record-select"' in page and isinstance(trace.get('policyDecisions'), list)
            and trace.get('routing', {}).get('llmAlternativesRecorded') is False)
        checks['action-provenance'] = all(a.get('decisionSource') == 'llm'
            for turn in trace.get('turns', []) for a in turn.get('actions', []))
        checks['fallback-not-execution'] = all(p.get('dispatchTurnId') is None and not p.get('actions')
            for p in trace.get('policyDecisions', []) if p.get('outcome') == 'fallback')
        checks['rsi-three-layers'] = rsi.get('schema') == 1 and all(k in rsi for k in ('l1', 'l2', 'l3'))
        checks['rsi-sources'] = all(rsi.get('sources', {}).get(k) is True for k in ('learning', 'shared', 'knowledge', 'engineering', 'receipts', 'cases'))
        checks['no-fabricated-improvement'] = rsi.get('l3', {}).get('verifiedImprovement') is None
        return {'ok': all(checks.values()), 'checks': checks, 'modelCalls': 0, 'worldActions': 0}
    except Exception as error:
        return {'ok': False, 'checks': checks, 'errorType': type(error).__name__}


if __name__ == '__main__':
    result = probe()
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
