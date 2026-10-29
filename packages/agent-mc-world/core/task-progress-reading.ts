import type {QueueStatus,TaskProgress} from './executor.ts';

/** One observed progress sample, scoped to the current executor task/step. */
export class TaskProgressReading {
  private latest: {observedAt:string;progress:TaskProgress}|null=null;
  constructor(private readonly now:()=>number=Date.now) {}

  observe(progress:TaskProgress):void {
    this.latest={observedAt:new Date(this.now()).toISOString(),progress:structuredClone(progress)};
  }

  clear():void {this.latest=null;}

  read(queue:QueueStatus):string {
    const running=queue.running;
    const latest=this.latest;
    const matching=latest&&(running?.id===latest.progress.taskId&&running.stepIndex===latest.progress.stepIndex
      || !running&&queue.waiting.some(task=>task.id===latest.progress.taskId));
    return '[Minecraft 当前任务进度；周期读数沿用原观察时间，完成与失败查独立终态]\n'+JSON.stringify({
      current:running?{taskId:running.id,stepIndex:running.stepIndex,stepCount:running.stepCount,
        step:running.step,elapsedMs:running.elapsedMs,count:running.count}:null,
      waiting:queue.waiting.map(task=>task.id),hold:queue.hold??null,
      lastObservedProgress:matching?latest:null,
      observationBoundary:'null means no matching periodic sample, not no progress. Earlier samples remain in the event ledger.',
    });
  }
}
