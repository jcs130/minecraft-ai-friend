/** Rename only the verified GLFW WGL library-name references in a private copy. */
export function aliasGlfwOpenGlLibrary(original) {
  const before=Buffer.from('opengl32.dll'),after=Buffer.from('mesaGL32.dll');
  if(before.length!==after.length)throw Error('Library aliases must have the same byte length');
  const patched=Buffer.from(original);let count=0,offset=0;
  while((offset=patched.indexOf(before,offset))>=0){after.copy(patched,offset);offset+=before.length;count++;}
  if(count!==2)throw Error('Unexpected GLFW library-name references');
  return patched;
}

/** The bridge retains all system GDI functions except Mesa's presentation. */
export function aliasGlfwPresentationLibrary(original) {
  const before=Buffer.from('GDI32.dll\0'),after=Buffer.from('agGDI.dll\0');
  const first=original.indexOf(before);
  if(first<0||original.indexOf(before,first+before.length)>=0)throw Error('Unexpected GLFW GDI import references');
  const patched=Buffer.from(original);after.copy(patched,first);return patched;
}
