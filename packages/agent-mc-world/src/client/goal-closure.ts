import type { ToolOutcome } from './contracts.ts';

export const GOAL_CLOSURE_CONTRACT = ' Rejected done requests are marked failed and include the missing evidence. Every request checks current conditions. Repeated rejection does not close the host decision turn or change the goal.';

export interface GoalClosureState {
  slot: number;
  identity: string;
  phase: string;
}

/** Recheck every closure and leave the next decision to the host. */
export function createGoalClosureHandler(options: {
  state(args: Record<string, unknown>): GoalClosureState | null;
  invoke(args: Record<string, unknown>): string;
  log(args: Record<string, unknown>, text: string): string;
}): (args: Record<string, unknown>) => string | ToolOutcome {
  const rejected = new Map<number, { identity: string; fingerprint: string }>();
  return args => {
    const before = options.state(args);
    const receipt = options.invoke(args);
    const after = options.state(args);
    if (!before || !after || before.identity !== after.identity) {
      if (before) rejected.delete(before.slot);
      return options.log(args, receipt);
    }
    const fingerprint = `${after.phase}\n${receipt}`;
    const previous = rejected.get(after.slot);
    const repeated = previous?.identity === after.identity && previous.fingerprint === fingerprint;
    rejected.set(after.slot, { identity: after.identity, fingerprint });
    const hint = repeated
      ? '\n[目标结案] 相同目标与里程碑仍返回同一拒绝结果；尚未结案，本轮与其他活动不受影响。判断型里程碑用 milestone 登记真实依据，机械条件按现场结果处理。'
      : '\n[目标结案] 未完成结案。done 只核验并关闭目标，不会执行步骤或代填判断；判断型里程碑用 milestone 登记真实依据，机械条件按现场结果处理。';
    return { text: options.log(args, receipt + hint), failed: true };
  };
}
