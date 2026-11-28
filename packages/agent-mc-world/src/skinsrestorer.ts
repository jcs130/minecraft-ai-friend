import type { SkinSelection } from './appearance.ts';

/** Opt-in command dialect. Construction and classification never submit a command. */
export function skinsRestorerRestoreCommand(selection: SkinSelection): string {
  if (!/^[0-9a-f]{40,64}$/.test(selection.textureHash) || !['slim','classic'].includes(selection.model))
    throw new Error('A Minecraft texture hash and model are required.');
  return '/skin url https://textures.minecraft.net/texture/' + selection.textureHash + ' ' + selection.model;
}

/** Classify commands in a profile using the SkinsRestorer dialect. Menus are not applied changes. */
export function skinsRestorerCommandKind(text: string, selection: SkinSelection): 'other' | 'inspect' | 'restore-selected' | 'change' {
  const [command, ...args] = text.trim().split(/\s+/u);
  if (!/^\/(?:skinsrestorer:)?skin$/iu.test(command)) return 'other';
  if (!args.length || ['help','menu','gui','search','history','favourite','favourites','notification','edit','upload'].includes(args[0].toLowerCase())) return 'inspect';
  const selected = skinsRestorerRestoreCommand(selection);
  return args.length === 3 && args[0].toLowerCase() === 'url' && ('/skin url '+args[1]+' '+args[2].toLowerCase()) === selected
    ? 'restore-selected' : 'change';
}
