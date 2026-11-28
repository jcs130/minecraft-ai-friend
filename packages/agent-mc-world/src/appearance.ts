import { skinsRestorerRestoreCommand } from './skinsrestorer.ts';
import type { ToolDef, WorldRequestFacts } from './contracts/host.ts';

export type SkinSelection = { textureHash: string; model: 'classic' | 'slim' };
type AppearanceFacts = Pick<WorldRequestFacts, 'selfSkin'> & { experience?: {serviceScope?: {account?: string}} };
const hashPattern = /^[0-9a-f]{40,64}$/;

export function compareSelfSkin(facts?: AppearanceFacts | null, expected?: SkinSelection) {
  const native = facts?.selfSkin;
  const scopeAccount = facts?.experience?.serviceScope?.account;
  // Microsoft credentials may identify a login alias (or email), not the in-game name.
  // The player-info producer already checked the connection UUID in that case.
  const account = scopeAccount?.startsWith('microsoft:') || scopeAccount?.startsWith('mojang:')
    ? undefined : scopeAccount?.replace(/^(?:offline|online):/i, '');
  const observed = native?.source === 'player-info' && native.uuid && native.username
    && hashPattern.test(native.textureHash) && (native.model === 'slim' || native.model === 'classic')
    && (!account || account === native.username || account === native.uuid) ? { ...native } : null;
  const comparison = !observed ? 'unknown' : !expected ? 'observed'
    : observed.textureHash === expected.textureHash && observed.model === expected.model ? 'matches' : 'differs';
  return { observed, comparison } as const;
}

export const APPEARANCE_DECL: Omit<ToolDef, 'handler'> = {
  name: 'mc_appearance', tags: ['read'], bodyControl: 'independent',
  description: 'Read the connected account’s server-issued vanilla skin. Optionally compare with the owner’s textureHash and slim/classic model. Missing native evidence is unknown. With a confirmed SkinsRestorer server, prepareRestore returns a suggested self-only chat step on mismatch. This tool does not execute it.',
  parameters: { type: 'object', additionalProperties: false, properties: { prepareRestore: {type:'string',enum:['skinsrestorer'],description:'Only when this server supports SkinsRestorer. Requires expected.'}, expected: {
    type: 'object', additionalProperties: false, required: ['textureHash', 'model'],
    properties: { textureHash: {type:'string',pattern:'^[0-9a-f]{40,64}$'}, model: {type:'string',enum:['slim','classic']} },
  } } },
};

export function appearanceTool(current: () => AppearanceFacts | null | undefined, name = APPEARANCE_DECL.name): ToolDef {
  return { ...APPEARANCE_DECL, name, handler: async (args, ctx) => {
    ctx.signal?.throwIfAborted();
    const expected = args.expected as Partial<SkinSelection> | undefined;
    if (args.prepareRestore !== undefined && (args.prepareRestore !== 'skinsrestorer' || !expected)) {
      return {failed:true,text:'prepareRestore requires expected and the skinsrestorer dialect.'};
    }
    if (Object.keys(args).some(k => k !== 'expected' && k !== 'prepareRestore') || (expected !== undefined && (
      !expected || typeof expected !== 'object' || Object.keys(expected).some(k => k !== 'textureHash' && k !== 'model')
      || typeof expected.textureHash !== 'string' || !hashPattern.test(expected.textureHash)
      || (expected.model !== 'classic' && expected.model !== 'slim')))) {
      return { failed:true, text:'expected requires a lowercase Minecraft textureHash and model slim or classic.' };
    }
    const reading = compareSelfSkin(current(), expected as SkinSelection | undefined);
    const appearance = args.prepareRestore === 'skinsrestorer' ? { ...reading, suggestedStep:
      reading.comparison === 'differs' ? { skill:'chat', text:skinsRestorerRestoreCommand(expected as SkinSelection) } : null } : reading;
    return { text: JSON.stringify(appearance), meta: { appearance } };
  } };
}
