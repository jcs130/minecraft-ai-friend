/** Only verified original YSM artifacts may select an obfuscated Java adapter. */
export function clientAppearanceTarget(metadata) {
  const installed=JSON.parse(metadata.replace(/^\uFEFF/,''));
  const versions={'2.4.1':'2.4.1','2.6.5-fabric+mc1.21.1':'2.6.5'};
  const version=Object.hasOwn(versions,installed.version)?versions[installed.version]:undefined;
  if(installed.id!=='yes_steve_model'||!version)
    throw Error('Unverified YSM dependency: '+installed.id+'@'+installed.version);
  return {version,declaredVersion:installed.version};
}
