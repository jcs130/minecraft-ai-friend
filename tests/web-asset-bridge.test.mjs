import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'vendor/modern-viewer/modern-viewer.js'), 'utf8');
const pack = JSON.parse(fs.readFileSync(path.join(root, 'vendor/modern-viewer/mod-assets/mod-pack.json'), 'utf8'));
const start = source.indexOf('function Boe(');
const end = source.indexOf('V();U();var WCe=', start);
assert(start > 0 && end > start);
const bridge = vm.runInNewContext('(' + source.slice(start, end) + ')');

test('actual bundled importer injects both block and item atlases', () => {
  const manager = { currentResources: { customTextures: {} } };
  assert.equal(bridge(manager, { pack }), true);
  assert.equal(manager.currentResources.customModels, pack.models);
  assert.equal(manager.currentResources.customTextures.blocks.textures, pack.textures);
  assert.equal(manager.currentResources.customTextures.items.textures, pack.itemTextures);
  assert.equal(bridge({}, { pack }), false);
});

// Execute the real bundled item dispatch method, with rendering hooks replaced
// only at the WebGL boundary. This catches no-layer0 3D items being skipped.
const methodStart = source.indexOf('getItemTexture(e,a={},r=!1,o=!1){');
const methodEnd = source.indexOf('};var EF=', methodStart);
assert(methodStart > 0 && methodEnd > methodStart);
const dispatch = vm.runInNewContext('({' + source.slice(methodStart, methodEnd) + '})').getItemTexture;
const renderer = {
  version: '1.21.1',
  modelsStore: { get: (_version, name) => pack.models[name] },
  resolveBlockModel: (model, name) => ({ model, name, route: 'geometry' }),
  tryGetFullBlock: () => { throw new Error('held item must request its actual geometry'); },
  resolveTexture: (texture) => ({ texture, route: 'texture' }),
};

test('actual item dispatch reaches both staff geometries without layer0', () => {
  for (const [staff, elements] of [['whispering_staff', 5], ['resonance_staff', 7]]) {
    const name = 'qiandeng_chanting:' + staff;
    const result = dispatch.call(renderer, name, {}, false, true);
    assert.equal(result.route, 'geometry');
    assert.equal(result.name, name);
    assert.equal(result.model.elements.length, elements);
    assert.equal(result.model.textures.layer0, undefined);
  }
});

test('bundled 2D item path remains intact without preloading a full catalogue', () => {
  const model = { textures: { layer0: 'test:item/example' } };
  const stub = { ...renderer, modelsStore: { get: (_version, name) => name === 'test:example' ? model : undefined } };
  const result = dispatch.call(stub, 'test:example', {}, false, false);
  assert.equal(result.route, 'texture');
  assert.equal(result.texture, model.textures.layer0);
  assert.equal(pack.stats.itemModels, 2);
});

test('default worker, distance and diagnostics guards are actually in the bundle', () => {
  assert(source.includes('let o=1;ja=new ire('));
  assert(source.includes('x0=DC(Tk("distance"),2,4,2)'));
  assert(source.includes('config:{fpsLimit:30,sceneBackground:"#8fc5ea",statsVisible:0'));
  assert(source.includes('if(!new URLSearchParams(location.search).has("diagnostic"))return;let i=document.createElement("pre")'));
  assert(source.includes('let t=Math.min(window.devicePixelRatio||1,1);'));
  const css = fs.readFileSync(path.join(root, 'vendor/modern-viewer/viewer.css'), 'utf8');
  assert(css.includes('html:not([data-qd-diagnostic="true"]) #mod-debug-panel'));
  assert(!css.includes('.boot.is-error{display:none'));
});

test('successful boot text is human readable while diagnostics and errors are preserved', () => {
  const start = source.indexOf('function v5(');
  const end = source.indexOf('function Lk(', start);
  assert(start > 0 && end > start);
  const state = { textContent: '', classList: { toggle() {} } };
  for (const [od, Ma, expected] of [[false, false, '第一人称'], [true, false, '环绕'], [false, true, '俯视']]) {
    const context = { Ju: state, od, Ma, URLSearchParams, location: { search: '' } };
    const status = vm.runInNewContext('(' + source.slice(start, end) + ')', context);
    status('Three.js r184', false, true);
    assert.equal(state.textContent, '画面已连接 · ' + expected);
    status('Array buffer allocation failed', true, true);
    assert.equal(state.textContent, 'Array buffer allocation failed');
    status('正在同步世界数据…', false, false);
    assert.equal(state.textContent, '正在同步世界数据…');
    context.location.search = '?diagnostic';
    status('Three.js r184', false, true);
    assert.equal(state.textContent, 'Three.js r184');
  }
});
