/** Core facts from a parsed 26.2 declare_commands packet. Does not invent commands. */
export type CommandTreePacket = {
  rootIndex?: number;
  nodes?: Array<{
    flags?: number;
    children?: number[];
    extraNodeData?: { name?: string; parser?: string } | string;
  }>;
};

export function commandTreeFacts(packet: CommandTreePacket | null | undefined) {
  const nodes = Array.isArray(packet?.nodes) ? packet!.nodes! : [];
  const rootIndex = Number.isInteger(packet?.rootIndex) ? packet!.rootIndex! : 0;
  const root = nodes[rootIndex];
  const literals: string[] = [];
  for (const child of root?.children ?? []) {
    const node = nodes[child];
    const extra = node?.extraNodeData;
    const name = typeof extra === 'string' ? extra : extra?.name;
    if (typeof name === 'string' && name) literals.push(name);
  }
  return {
    nodeCount: nodes.length,
    rootIndex,
    rootLiteralCount: literals.length,
    rootLiterals: literals.slice().sort(),
    hasGive: literals.includes('give'),
    hasParticle: literals.includes('particle'),
    hasPlaysound: literals.includes('playsound'),
  };
}

/** Entry clues only. A literal is not an implemented skill or a working voice client. */
export function commandEntryHints(literals: readonly string[]) {
  const voiceRelated = literals.filter((name) => {
    const n = name.toLowerCase();
    return n.includes('voicechat') || n === 'plasmo' || n === 'plasmovoice' || n.startsWith('plasmo')
      || n === 'vc' || n === 'pv';
  });
  const helpRelated = literals.filter((name) => {
    const n = name.toLowerCase();
    return n === 'help' || n === '?' || n.endsWith(':help');
  });
  return { voiceRelated, helpRelated };
}
