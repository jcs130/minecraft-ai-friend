import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutDecisionGraph, routeDecisionEdge} from '../admin/public/decision-canvas.js';
import {buildEvolutionGraph} from '../admin/public/decision-model.js';

const node = (id, kind = id, extra = {}) => ({id, kind, title: id, subtitle: '', ...extra});
const policy = (candidateCount, actionCount) => ({kind: 'policy', nodes: [
  node('observation'), node('policy'),
  ...Array.from({length: candidateCount}, (_, i) => node(`candidate-${i}`, 'candidate')),
  node('gate'),
  ...(actionCount ? [...Array.from({length: actionCount}, (_, i) => node(`action-${i}`, 'action')), node('feedback')]
    : [node('fallback')]),
]});
function assertInside(graph, vertical = false) {
  const layout = layoutDecisionGraph(graph, vertical);
  assert.equal(layout.map.size, graph.nodes.length);
  assert.ok(Number.isFinite(layout.width) && layout.width > 0);
  assert.ok(Number.isFinite(layout.height) && layout.height > 0);
  for (const [id, item] of layout.map) {
    assert.ok(item.x - 5 >= 0, `${id} left halo is inside the viewBox`);
    assert.ok(item.y - 5 >= 0, `${id} top halo is inside the viewBox`);
    assert.ok(item.x + item.w + 5 <= layout.width, `${id} right halo is inside the viewBox`);
    assert.ok(item.y + item.h + 5 <= layout.height, `${id} bottom halo is inside the viewBox`);
  }
  return layout;
}

test('policy candidate and execution columns stay inside the viewBox with six action receipts', () => {
  for (const count of [2, 6]) {
    const graph = policy(count, 6), layout = assertInside(graph);
    assert.ok(layout.map.get('action-0').y >= 75);
    assert.ok(layout.map.get('candidate-0').y >= 75);
    assert.ok(layout.map.get('feedback').y > layout.map.get('action-5').y);
  }
});

test('empty policy candidates and selection-only decisions retain bounded layout', () => {
  for (const graph of [policy(0, 0), policy(0, 6), {kind: 'policy', nodes: [node('observation'), node('policy'), node('gate')]}, {kind: 'policy', nodes: []}]) {
    assertInside(graph);
  }
});

test('LLM ten-node snake and RSI eight-node layers are fully visible', () => {
  assertInside({kind: 'llm', nodes: [node('observation'), node('llm'), ...Array.from({length: 6}, (_, i) => node(`action-${i}`, 'action')), node('feedback'), node('reflection')]});
  const rsi = buildEvolutionGraph();
  assert.equal(rsi.nodes.length, 8);
  const layout = assertInside(rsi);
  for (const layer of ['l1', 'l2', 'l3']) {
    const positions = rsi.nodes.filter(item => item.layer === layer).map(item => layout.map.get(item.id).y);
    assert.equal(new Set(positions).size, 1);
  }
});

test('vertical views keep every node in bounds and RSI reflection in its original semantic order', () => {
  const rsi = buildEvolutionGraph();
  const llm = {kind: 'llm', nodes: [node('observation'), node('llm'), ...Array.from({length: 6}, (_, i) => node(`action-${i}`, 'action')), node('feedback'), node('reflection')]};
  for (const graph of [policy(0, 0), policy(2, 6), policy(6, 6), llm, rsi]) assertInside(graph, true);
  const layout = layoutDecisionGraph(rsi, true);
  const byPosition = [...layout.map.values()].sort((a, b) => a.y - b.y).map(item => item.id);
  assert.deepEqual(byPosition, rsi.nodes.map(item => item.id));
  assert.ok(layout.map.get('experience').y < layout.map.get('knowledge').y);
  assert.ok([...layout.map.values()].every(item => item.h >= 74 && item.h <= 86));
  for (let i = 1; i < byPosition.length; i++) {
    assert.ok(layout.map.get(byPosition[i]).y - layout.map.get(byPosition[i - 1]).y <= 110);
  }
});

test('RSI return and cross-layer branch routes avoid unrelated nodes in both orientations', () => {
  const graph = buildEvolutionGraph();
  const crossing = graph.edges.filter(edge => edge.to === 'life' || edge.from === 'experience' && edge.to === 'issue');
  for (const vertical of [false, true]) {
    const layout = layoutDecisionGraph(graph, vertical);
    const routes = crossing.map(edge => ({edge, route: routeDecisionEdge(edge, layout, graph.kind, vertical)}));
    for (const {edge, route} of routes) {
      assert.ok(route.points.length >= 4);
      for (const [x, y] of route.points) {
        assert.ok(x >= 0 && x <= layout.width && y >= 0 && y <= layout.height, `${edge.id} route remains in viewBox`);
      }
      for (let i = 1; i < route.points.length; i++) {
        const [ax, ay] = route.points[i - 1], [bx, by] = route.points[i];
        assert.ok(ax === bx || ay === by);
        for (const [id, rect] of layout.map) {
          if (id === edge.from || id === edge.to) continue;
          const crosses = ax === bx
            ? ax > rect.x && ax < rect.x + rect.w && Math.max(ay, by) > rect.y && Math.min(ay, by) < rect.y + rect.h
            : ay > rect.y && ay < rect.y + rect.h && Math.max(ax, bx) > rect.x && Math.min(ax, bx) < rect.x + rect.w;
          assert.equal(crosses, false, `${edge.id} must not cross ${id}`);
        }
      }
    }
    if (!vertical) {
      const labels = routes.map(item => item.route.label).filter(Boolean);
      assert.equal(labels.length, 2);
      assert.ok(Math.abs(labels[0].y - labels[1].y) > 25, 'return loop labels have separate rows');
    }
  }
});
