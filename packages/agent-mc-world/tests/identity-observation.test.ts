import {expect,it} from 'vitest';
import {identityObservations} from '../core/identity-observation.ts';
it('projects only already-observed authoritative identities with matching observation time and visibility',()=>{
 const at=Date.parse('2026-11-13T07:09:35Z');
 const entities=[{entityId:462,identity:{uuid:'af86ae0c-c524-467b-a28c-8da5af88d45e',source:'qiandengji-maids/v1'},distance:1,direction:'east',dy:0,visible:false,observation:{visibility:'occluded-nearby',lineOfSight:false}},
  {entityId:999,name:'allay',distance:1,direction:'east',visible:true}];
 const rows=identityObservations({entities} as any,at);
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({entityId:462,sampledAt:'2026-11-13T07:09:35.000Z',distance:1,lineOfSight:false});
 expect(rows[0]).not.toHaveProperty('position');expect(identityObservations({entities:[]},at)).toEqual([]);
});
