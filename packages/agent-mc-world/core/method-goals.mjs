/** Goal data crosses the worker boundary; the owning backend checks arrival. */
export class GoalBlock {
  constructor(x,y,z){
    if(![x,y,z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=30_000_000))throw new TypeError('Goal coordinates must be finite');
    this.x=Math.floor(x);this.y=Math.floor(y);this.z=Math.floor(z);
  }
  isEnd(node){return node.x===this.x&&node.y===this.y&&node.z===this.z;}
}
export class GoalNear extends GoalBlock {
  constructor(x,y,z,range){super(x,y,z);if(!Number.isInteger(range)||range<0||range>16)throw new TypeError('GoalNear range must be integer0..16');this.rangeSq=range*range;}
  isEnd(node){return (node.x-this.x)**2+(node.y-this.y)**2+(node.z-this.z)**2<=this.rangeSq;}
}
