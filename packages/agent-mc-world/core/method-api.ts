/** On-demand contracts for the program SDK; native primitives retain their own guide. */
import { nativeApiHelp } from './method-mineflayer.ts';

const SDK_API = Object.freeze({
  'mc.state': 'await mc.state(): {sampledAt,connectionGeneration,snapshot,flight,queue,combatActive,combat,method}. '
    + 'snapshot can be null; position/dimension/health/food/inventory/equipment are under snapshot. '
    + 'No block scan is performed. Missing readings are unknown. Preserve sampledAt and connectionGeneration when comparing observations.',
  'mc.do': 'await mc.do(steps): {accepted,taskId?,kind,done,receipt,steps?,state}. '
    + 'Waits for this group\'s executor terminal, unlike the mc_do tool which returns on admission. '
    + 'Rejected groups have accepted:false, done:false, kind:"rejected" and no executed steps. '
    + 'Executed steps are {step,outcome,why}; step is one-based; outcome is ok/noop/fail/skip/partial/cut; why is string|null. '
    + 'There is no steps[n].done or steps[n].receipt. Read the group receipt for the actual operation and state for the fresh observation. '
    + 'done:true and outcome:"ok" certify the requested operation, not your program\'s declared objective or a new world change. '
    + 'A successful right click can leave blocks and inventory unchanged. use without item explicitly uses an empty hand; it does not infer an item from the program name or previous equip. '
    + 'For a known local postcondition, existing steps accept expect:{block:"<id>",at:[x,y,z]}, '
    + 'expect:{has:{item:"<id>",count:n}}, expect:{holding:{item:"<id>"}}, or expect:{near:[x,y,z],within:n}. '
    + 'These test current state, not a delta: an already-satisfied condition is not evidence that this action changed it. '
    + 'For net progress, compare relevant before/after block or inventory readings yourself; keep unknowns unknown. '
    + 'Server transactions still need authoritative replies. Expand mc_script {runId,call} for the complete task result before saving a claim.',
  'mc.flightPlan': 'await mc.flightPlan(args): the same read-only geometry and budget preview as mc_flight_plan. '
    + 'It does not move, cast, grant permission or prove arrival. Read mc_flight_plan schema for arguments; execution revalidates geometry and permission.',
});

export function methodApiHelp(name: string): string {
  if (name === 'index') return `程序 SDK（按需用 api:"mc.do" 等读取）：${Object.keys(SDK_API).join(', ')}\n${nativeApiHelp('index')}`;
  if (Object.hasOwn(SDK_API, name)) return SDK_API[name as keyof typeof SDK_API];
  return nativeApiHelp(name);
}
