import {expect,it} from 'vitest';
import {aliasGlfwOpenGlLibrary} from '../scripts/client-graphics-loader.mjs';

it('changes only two equal-length library names in a copy, preserving all other bytes',()=>{
  const original=Buffer.from('header\0opengl32.dll\0unaltered\0opengl32.dll\0footer');
  const snapshot=Buffer.from(original);
  const output=aliasGlfwOpenGlLibrary(original);
  expect(output).toEqual(Buffer.from('header\0mesaGL32.dll\0unaltered\0mesaGL32.dll\0footer'));
  expect(output.length).toBe(original.length);
  expect(original).toEqual(snapshot);
});
it.each([0,1,3])('rejects an unverified number of loader references: %i',count=>{
  expect(()=>aliasGlfwOpenGlLibrary(Buffer.from(('opengl32.dll\0').repeat(count))))
    .toThrow('Unexpected GLFW library-name references');
});
