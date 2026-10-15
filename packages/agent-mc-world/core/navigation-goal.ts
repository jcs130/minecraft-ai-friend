/** Serializable subset shared by Mineflayer goals and the native navigator. */
export interface NavigationGoal { x:number; y:number; z:number; range:number; }
export function navigationGoal(value:unknown):NavigationGoal {
  const v=value as Record<string,unknown>|null;
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['x','y','z','rangeSq'].includes(k))
    || ![v.x,v.y,v.z].every(n=>typeof n==='number'&&Number.isInteger(n)&&Math.abs(n)<=30_000_000))
    throw new Error('Navigation needs GoalBlock/GoalNear with integer x/y/z, no custom goal callbacks');
  const range=v.rangeSq===undefined?0:Math.sqrt(Number(v.rangeSq));
  if(v.rangeSq!==undefined&&(typeof v.rangeSq!=='number'||!Number.isInteger(range)||range<0||range>16))
    throw new Error('GoalNear range must be integer0..16');
  return {x:v.x as number,y:v.y as number,z:v.z as number,range};
}
