import test from 'node:test';import assert from 'node:assert/strict';
import {PLAY_RTC_HTTP_PATHS,isPlayRtcPath,playRtcBodyLimit} from '../src/play-rtc-http-policy.mjs';
test('outer proxy exposes exactly three RTC paths, never a wildcard subtree',()=>{
 for(const p of PLAY_RTC_HTTP_PATHS)assert.equal(isPlayRtcPath(p),true);
 for(const p of ['/api/play/rtc','/api/play/rtc/status/','/api/play/rtc/admin','/api/play/rtc/status?x=1','/api/play/rtc/../control'])assert.equal(isPlayRtcPath(p),false);
});
test('only SDP JSON gets the expanded envelope budget; ordinary writes are unchanged',()=>{
 assert.equal(playRtcBodyLimit('/api/play/rtc/offer'),65536);
 for(const p of ['/api/play/rtc/receipt','/api/play/control','/api/session'])assert.equal(playRtcBodyLimit(p),8192);
});
