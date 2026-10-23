import { describe, expect, it } from 'vitest';
import { parseProcedure, PROCEDURE_LIMITS, procedureHash, resolveProcedure } from '../core/support/procedure.ts';
import { fixtureBlobs, procedureFixture, procedureRef } from './procedure-fixture.ts';

describe('portable versioned procedure artifacts', () => {
  it('reads legacy artifacts without rewriting their original bytes or hashes', () => {
    const old=procedureFixture('legacy','return 1;', {schema:'cortico.procedure/v1'});
    const raw=JSON.stringify(old), parsed=parseProcedure(JSON.parse(raw));
    expect(parsed.schema).toBe('cortico.procedure/v1');expect(parsed.revision).toBe(old.revision);expect(JSON.stringify(old)).toBe(raw);
    expect(procedureFixture('new','return 1;').schema).toBe('agent-mc.procedure/v1');
  });
  it('pins exact dependency versions and verifies content before returning an isolated graph', () => {
    const child = procedureFixture('child', 'return params.value;');
    const root = procedureFixture('root', 'return await methods.run("child",params);', {dependencies: {child: procedureRef(child)}});
    const graph = resolveProcedure(procedureRef(root), root.adapter, fixtureBlobs([root, child]));
    expect(Object.keys(graph.versions)).toHaveLength(2);
    expect(graph.versions[root.revision].dependencies.child.revision).toBe(child.revision);
    graph.versions[child.revision].code = 'changed';
    expect(child.code).toBe('return params.value;');
    expect(procedureHash({z: 1, a: {b: 2, a: 3}})).toBe(procedureHash({a: {a: 3, b: 2}, z: 1}));
  });

  it('rejects tampered source, wrong hashes, unavailable handles and incompatible capability adapters', () => {
    const v = procedureFixture('root', 'return 1;');
    expect(() => parseProcedure({...v, code: 'return 2;'})).toThrow('source hash mismatch');
    expect(() => parseProcedure({...v, description: 'changed'})).toThrow('revision hash mismatch');
    expect(() => resolveProcedure({...procedureRef(v), revision: 'a'.repeat(64)}, v.adapter, fixtureBlobs([v]))).toThrow('reference hash mismatch');
    expect(() => resolveProcedure(procedureRef(v), v.adapter, () => null)).toThrow('unavailable');
    expect(() => resolveProcedure(procedureRef(v), 'document-edit/v1', fixtureBlobs([v]))).toThrow('adapter mismatch');
  });

  it('checks the full depth of shared dependencies even when their shorter path was visited first', () => {
    const leaf = procedureFixture('leaf', 'return 1;');
    const shared = procedureFixture('shared', 'return 1;', {dependencies: {leaf: procedureRef(leaf)}});
    const first = procedureFixture('first', 'return 1;', {dependencies: {shared: procedureRef(shared)}});
    const second = procedureFixture('second', 'return 1;', {dependencies: {first: procedureRef(first)}});
    const root = procedureFixture('root', 'return 1;', {dependencies: {shared: procedureRef(shared), second: procedureRef(second)}});
    expect(() => resolveProcedure(procedureRef(root), root.adapter, fixtureBlobs([root, shared, leaf, first, second])))
      .toThrow('depth exceeded');
  });

  it('bounds combined source and unique dependency versions', () => {
    const children = Array.from({length: 5}, (_, i) => procedureFixture(`child-${i}`, '// ' + 'x'.repeat(9990)));
    const root = procedureFixture('root', 'return 1;', {dependencies: Object.fromEntries(children.map(v => [v.id, procedureRef(v)]))});
    expect(() => resolveProcedure(procedureRef(root), root.adapter, fixtureBlobs([root, ...children]))).toThrow('source budget');
    const leaves = Array.from({length: PROCEDURE_LIMITS.versions - 1}, (_, i) => procedureFixture(`leaf-${i}`, 'return 1;'));
    const nested = procedureFixture('nested', 'return 1;', {dependencies: {leaf: procedureRef(leaves[0])}});
    const wide = procedureFixture('wide', 'return 1;', {dependencies: Object.fromEntries([nested, ...leaves.slice(1)].map(v => [v.id, procedureRef(v)]))});
    expect(() => resolveProcedure(procedureRef(wide), wide.adapter, fixtureBlobs([wide, nested, ...leaves]))).toThrow('count exceeded');
  });
});
