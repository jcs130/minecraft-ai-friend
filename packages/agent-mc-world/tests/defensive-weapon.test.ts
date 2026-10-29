import { expect, it } from 'vitest';
import { createDefensiveWeaponSelector, type DefensiveWeaponFrame } from '../src/client/index.ts';
const frame:DefensiveWeaponFrame={phase:'start',current:'melee',heldItem:'bow',rangedReady:true,meleeReady:true,distance:null};
it('preserves a ready equipped bow across close automatic-defense ticks, not a bow merely in the bag',()=>{
  const choose=createDefensiveWeaponSelector();
  expect(choose(frame)).toBe('ranged');
  expect(choose({...frame,phase:'tick',current:'ranged',distance:2})).toBe('ranged');
  expect(choose({...frame,heldItem:'iron_sword'})).toBe('melee');
  expect(choose({...frame,phase:'tick',current:'melee',distance:2})).toBe('melee');
});
it('rechecks actual ranged readiness and never makes empty-hand melee the preferred weapon',()=>{
  const choose=createDefensiveWeaponSelector();choose(frame);
  expect(choose({...frame,phase:'tick',rangedReady:false,current:'ranged',distance:2})).toBe('melee');
  expect(choose({...frame,heldItem:null,meleeReady:false,distance:2})).toBe('ranged');
});
it('retains hybrid distance hysteresis when no ready ranged hand was selected at encounter start',()=>{
  const choose=createDefensiveWeaponSelector();
  expect(choose({...frame,heldItem:'iron_sword'})).toBe('melee');
  expect(choose({...frame,phase:'tick',current:'melee',distance:14})).toBe('ranged');
  expect(choose({...frame,phase:'tick',current:'ranged',distance:3})).toBe('melee');
});
