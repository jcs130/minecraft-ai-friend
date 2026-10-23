import type { ToolDef } from './support/host-contract.ts';
import { COMBAT_RULES_SCHEMA } from './combat-rules.ts';
import { COMBAT_ROUTINES_SCHEMA } from './combat-routines.ts';
export const COMBAT_TACTIC_TOOL: Omit<ToolDef,'handler'> = {
    name: 'mc_combat_tactic',
    tags: ['write'],
    description:
      'Read or update combat spell rules and an agent-authored fast tactic program. {} reads it; omitted fields keep their current values; '
      + '{enabled:false} clears it. A spell list of server-listed combat spell IDs sets priority order while fighting; '
      + 'healAtOrBelow is the optional ability provider healing threshold. Without a provider it never sends a command. '
      + 'Nonempty rules replace the unconditional spell priority: ordered observed conditions are rechecked each combat tick and the first ready match wins; no match means no automatic offensive cast. rules:[] restores spells/default priority. '
       + 'The host selects candidates from {battlefield:true}; submit {choice:{candidate,tacticRevision,connectionGeneration}} for fresh validation. No inference runs in this extension. '
      + 'program:{name,code,params?} installs your JavaScript synchronous function body with frame and params; return {candidates,instructions}. '
      + 'frame.actionPool contains currently executable casts, engagements and collision-checked directions; you may select, reorder or relabel them, or construct step destinations 0.5 to 1.6 blocks away. '
      + 'Read actors from frame.battlefield.actors (relation, health, distance, lineOfSight); candidate kinds are cast, engage, step, retreat, track and method. Default choices support proactive engage or retreat before injury; resumable body work pauses and resumes. Track is only an explicit authored action-pool primitive: it watches without attacking and stops current attacks. Follow tasks remain explicit body tasks. There is no frame.snapshot.enemies or melee candidate. '
      + 'The program constructs choices from fresh battlefield facts independently of the main model; the fast model chooses and the combat controller executes. '
      + 'routines:[{id,intent,procedure,params?,durationMs?}] registers exact saved mc_script library references in the fast menu; routines:[] removes them. '
      + 'Read and validate/save a method first. Registration checks its immutable version and does not execute it or claim it effective. '
      + 'A method option starts that existing script only when the body is free; its original run ID, SDK trace and terminal remain readable with mc_script. '
      + 'An installed program may filter/reorder method options from actionPool; its returned priority order is preserved. '
      + 'Direct steps last at most 700ms and share the combat body lease; survival, task ownership and collisions remain checked. '
      + 'Use program:null to remove it. No imports, files, network or raw bot; 50ms worker execution budget, separate 500ms response deadline. A scheduling timeout (including cold startup) allows only one retry on a new sample at least one second later; otherwise revise the program. Built-in choices remain a fallback; budgets are not raised. '
      + '{decisions:true} lists recent submitted choices; {decision:id} reads the receipt. Sending an action does not prove a successful encounter. '
      + 'Keep source and previous versions in your own methods library; compare combat reports before calling a revision an improvement. '
      + 'The World checks observed spell availability, mana, targets and announced cooldowns; '
      + 'server replies still decide success. Settings and the last five observed combat receipts persist per world across restarts. '
      + '{} also reads current capability constraints and recent receipt IDs; {report:id} expands one receipt. '
      + 'Receipts are observations for reviewing and revising a tactic, not learned conclusions.',
    parameters: {
      type: 'object',
      properties: {
        choice: { type:'object',additionalProperties:false,required:['candidate','tacticRevision','connectionGeneration'],
          properties:{candidate:{type:'object'},tacticRevision:{type:'integer'},connectionGeneration:{type:'integer'},
            decisionId:{type:'string',minLength:1,maxLength:128}} },
        enabled: { type: 'boolean' },
        spells: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true,
          items: { type: 'string', pattern: '^[a-z][a-z0-9_:-]{0,63}$' } },
        healAtOrBelow: { type: 'integer', minimum: 1, maximum: 20 },
        rules: COMBAT_RULES_SCHEMA,
        routines: COMBAT_ROUTINES_SCHEMA,
        program: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 80 },
            code: { type: 'string', minLength: 1, maxLength: 12000 }, params: { type: 'object' } }, required: ['name', 'code'] }] },
        decisions: { type: 'boolean', description: 'Read the last eight decision summaries; use alone.' },
        decision: { type: 'integer', minimum: 1, description: 'Expand one decision input, chosen action and subsequent physical observation; use alone.' },
        battlefield: { type: 'boolean', description: 'Read the current programmatic battlefield, abilities and eligible choices; use alone. Missing health or party identity stays unknown.' },
        report: { type: 'integer', minimum: 1, description: 'Read one observed combat receipt by its returned ID; do not combine with setting fields.' },
      },
      required: [],
    },
  };
