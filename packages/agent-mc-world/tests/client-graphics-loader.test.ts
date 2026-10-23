import {expect,it} from 'vitest';
import {aliasGlfwOpenGlLibrary,aliasGlfwPresentationLibrary} from '../scripts/client-graphics-loader.mjs';

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

it('redirects the sole GDI import to the private presentation bridge without changing the original',()=>{
  const original=Buffer.from('header\0GDI32.dll\0SwapBuffers\0GetDeviceCaps\0footer');
  const snapshot=Buffer.from(original);
  const output=aliasGlfwPresentationLibrary(original);
  expect(output).toEqual(Buffer.from('header\0agGDI.dll\0SwapBuffers\0GetDeviceCaps\0footer'));
  expect(output.length).toBe(original.length);
  expect(original).toEqual(snapshot);
});
it.each(['', 'GDI32.dll.extra\0', 'GDI32.dll\0GDI32.dll\0'])('rejects absent, partial or ambiguous GDI imports: %j',input=>{
  expect(()=>aliasGlfwPresentationLibrary(Buffer.from(input)))
    .toThrow('Unexpected GLFW GDI import references');
});
