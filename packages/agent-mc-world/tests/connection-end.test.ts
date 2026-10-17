import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {onConnectionEnd} from '../core/connection-end.ts';
import {installBreathingReadings} from '../core/breathing.ts';
import {watchFlightAbilities} from '../core/flight.ts';
import {attachHearing,hearingOf} from '../core/perception-hearing.ts';
import {bindNativeGuiPresentation,nativeGuiPresented,ShowPacer} from '../core/show.ts';
import {methodHarness} from './method-harness.ts';
it('fans out real per-connection cleanup without changing the listener limit or accumulating across reconnects',()=>{
  for(let connection=0;connection<5;connection++) {
    const bot=new EventEmitter(),calls:string[]=[];
    const disposers=Array.from({length:16},(_,i)=>onConnectionEnd(bot,reason=>calls.push(`${i}:${reason}`)));
    expect(bot.getMaxListeners()).toBe(10);expect(bot.listenerCount('end')).toBe(1);
    disposers[3]();bot.emit('end','timeout');bot.emit('end','late');
    expect(calls).toHaveLength(15);expect(calls).not.toContain('3:timeout');
    expect(bot.listenerCount('end')).toBe(0);disposers.forEach(d=>d());
    onConnectionEnd(bot,()=>calls.push('late subscription'));expect(bot.listenerCount('end')).toBe(0);
  }
});
it('disposes all subscriptions before end and completes other cleanup when one callback fails',()=>{
  const bot=new EventEmitter(),called=vi.fn(),warn=vi.spyOn(process,'emitWarning').mockImplementation(()=>{});
  try {
    const release=onConnectionEnd(bot,called);release();expect(bot.listenerCount('end')).toBe(0);
    onConnectionEnd(bot,()=>{throw new Error('cleanup failure');});onConnectionEnd(bot,called);
    bot.emit('end');expect(called).toHaveBeenCalledOnce();expect(warn).toHaveBeenCalledOnce();
  } finally {warn.mockRestore();}
});
it('installs actual feature lifecycles once and removes their packet listeners on each disconnect',async()=>{
  for(let generation=0;generation<3;generation++) {
    const r=methodHarness();
    try {
      const bot=r.bot as never;
      const breath=installBreathingReadings(bot),flight=watchFlightAbilities(bot),hearing=attachHearing(bot,'');
      for(let i=0;i<12;i++) {
        expect(installBreathingReadings(bot)).toBe(breath);
        expect(watchFlightAbilities(bot)).toBe(flight);
        expect(attachHearing(bot,'')).toBe(hearing);
        bindNativeGuiPresentation(bot,()=>({ready:true,epoch:i,playerUuid:'fixture'}));
        new ShowPacer(null,{bot});
      }
      await vi.waitFor(()=>expect(hearingOf(bot)?.source).not.toBe('loading'));
      expect(r.bot.listenerCount('end')).toBe(1);
      expect(r.bot.listenerCount('breath')).toBe(1);
      expect(r.bot._client.listenerCount('abilities')).toBe(1);
      expect(nativeGuiPresented(bot)).toBe(true);
      r.bot.emit('end','timeout');
      expect(r.bot.listenerCount('end')).toBe(0);
      expect(r.bot.listenerCount('breath')).toBe(0);
      expect(r.bot._client.listenerCount('abilities')).toBe(0);
      expect(r.bot._client.listenerCount('sound_effect')).toBe(0);
      expect(hearingOf(bot)?.source).toBe('unavailable');
      expect(nativeGuiPresented(bot)).toBe(false);
    }finally{r.close();}
  }
});
