import assert from 'node:assert/strict';import{test}from'node:test';import{mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve,dirname,basename}from'node:path';
import{readServerOperators,isServerOperator}from'./read-server-operators.mjs';
function cleanup(root){const target=resolve(root);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^mc-operator-(read|invalid)-/);rmSync(target,{recursive:true,force:true});}
test('operator inspection never mutates Paper or promotes a name called list',()=>{
 const root=mkdtempSync(join(tmpdir(),'mc-operator-read-'));
 try{const file=join(root,'ops.json'),before=JSON.stringify([{name:'Goddess',uuid:'b2f9ceb0-8271-3470-b99f-e1c3ffe4edbd',level:4}]);writeFileSync(file,before);
  assert.equal(isServerOperator(root,'GODDESS'),true);assert.equal(isServerOperator(root,'list'),false);assert.equal(isServerOperator(root,'ag_AuthQA'),false);
  const rows=readServerOperators(root);rows[0].name='list';assert.equal(readFileSync(file,'utf8'),before);assert.equal(readServerOperators(root)[0].name,'Goddess');
 }finally{cleanup(root);}
});
test('malformed registries fail without writing any data',()=>{
 const root=mkdtempSync(join(tmpdir(),'mc-operator-invalid-'));
 try{const file=join(root,'ops.json');for(const value of['{}','[null]','[{"name":"Goddess"}]','broken']){writeFileSync(file,value);assert.throws(()=>readServerOperators(root));assert.equal(readFileSync(file,'utf8'),value);}}
 finally{cleanup(root);}
});
