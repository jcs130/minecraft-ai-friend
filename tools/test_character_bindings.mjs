import assert from 'node:assert/strict';
import { bindTag, uuidFromIntArray } from './bind_character_models.mjs';
import { exactPlayer, modelEvidence, vectorEvidence } from './smoke_game_models.mjs';

const compound = value => ({ type: 'compound', value });
const original = { type: 'compound', name: '', value: {
  UUID: { type: 'intArray', value: [0, -1, -2147483648, 2147483647] },
  Inventory: { type: 'list', value: { type: 'compound', value: [] } },
  Health: { type: 'float', value: 18 },
} };
const snapshot = structuredClone(original);
const fixed = bindTag(original, 'qiandengji_naruto');
assert.deepEqual(original, snapshot);
assert.deepEqual(fixed.value.Inventory, original.value.Inventory);
assert.equal(fixed.value['neoforge:attachments'].value['yes_steve_model:model_id'].value.model_id.value, 'qiandengji_naruto');
assert.deepEqual(bindTag(fixed, 'qiandengji_naruto'), fixed);
const old = structuredClone(original);
old.value['neoforge:attachments'] = compound({
  'other:settings': compound({ level: { type: 'int', value: 7 } }),
  'yes_steve_model:model_id': compound({
    model_id: { type: 'string', value: 'old' },
    molang_storage: compound({ custom: { type: 'float', value: 2 } }),
  }),
});
const altered = bindTag(old, 'qiandengji_kirito');
assert.deepEqual(altered.value['neoforge:attachments'].value['other:settings'], old.value['neoforge:attachments'].value['other:settings']);
assert.deepEqual(altered.value['neoforge:attachments'].value['yes_steve_model:model_id'].value.molang_storage, old.value['neoforge:attachments'].value['yes_steve_model:model_id'].value.molang_storage);
assert.equal(uuidFromIntArray([0, -1, -2147483648, 2147483647]), '00000000-ffff-ffff-8000-00007fffffff');
assert.throws(() => bindTag(original, 'unrelated'));
assert.throws(() => uuidFromIntArray([1, 2, 3]));
assert.equal(exactPlayer('00000000-ffff-ffff-8000-00007fffffff'), '@a[nbt={UUID:[I;0,-1,-2147483648,2147483647]}]');
assert.throws(() => exactPlayer('Naruto'));
assert.deepEqual(vectorEvidence('Position: [-1.5d, 67d, 22.75d]', 3), [-1.5, 67, 22.75]);
assert.throws(() => vectorEvidence('Position: [NaNd, 67d, 22.75d]', 3));
assert.deepEqual(modelEvidence('Body: {model_id: "qiandengji_naruto", select_texture: "skin", disabled: 0b}', 'qiandengji_naruto'),
  { modelId: 'qiandengji_naruto', textureId: 'skin', enabled: true });
assert.throws(() => modelEvidence('{model_id: "wrong", select_texture: "skin", disabled: 0b}', 'qiandengji_naruto'));
assert.throws(() => modelEvidence('{model_id: "qiandengji_naruto", select_texture: "skin", disabled: 1b}', 'qiandengji_naruto'));
console.log('16 binding and model-scene assertions passed');
