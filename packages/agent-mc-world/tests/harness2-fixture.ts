/** Java 1.21.1 collision physics, core sandbox and scoped method evidence; no TCP or LLM. */
import { createPhysicsMethodPractice } from '../src/learning/physics-practice.ts';
export const STEP_CODE=`const target=(await mc.state()).target;
try {
  await bot.setControlState('forward',true);
  for(let i=0;i<7;i++) {
    const p=(await mc.state()).snapshot.position;
    const dx=target.x-p.x,dz=target.z-p.z;
    if(Math.hypot(dx,dz)<0.65) break;
    await bot.look(Math.atan2(-dx,-dz),0);
    await bot.waitForTicks(Math.min(20,Math.max(1,Math.floor(Math.hypot(dx,dz)/0.22))));
  }
} finally { await bot.clearControlStates(); }
return (await mc.state()).snapshot.position;`;
export function physicsPractice(directory: string) {
  return createPhysicsMethodPractice({directory,seeds:[1,2],binding:{instanceId:'offline-physics',realm:'practice-fixtures',account:'practice-bot',agent:'fixture',isolated:true}});
}
