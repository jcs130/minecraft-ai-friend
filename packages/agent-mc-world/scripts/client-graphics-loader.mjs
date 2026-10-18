/** Rename only the verified GLFW WGL library-name references in a private copy. */
export function aliasGlfwOpenGlLibrary(original) {
  const before=Buffer.from('opengl32.dll'),after=Buffer.from('mesaGL32.dll');
  if(before.length!==after.length)throw Error('Library aliases must have the same byte length');
  const patched=Buffer.from(original);let count=0,offset=0;
  while((offset=patched.indexOf(before,offset))>=0){after.copy(patched,offset);offset+=before.length;count++;}
  if(count!==2)throw Error('Unexpected GLFW library-name references');
  return patched;
}
