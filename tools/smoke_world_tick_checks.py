"""Observe natural crop/soil ticks and expiring-ticket cleanup in the isolated fixture."""
import json
import time
import uuid


def check_world_tick(*,response,command,invoke,run,base,data,fake,checks,details):
    def qa(action):
        value=response('qdworldtickqa '+action,'QD_WORLD_TICK_QA ')
        if not value.get('ok'):raise RuntimeError('world_tick_fixture_failed: '+str(value))
        return value
    def until(predicate,seconds=150):
        deadline=time.monotonic()+seconds
        while time.monotonic()<deadline:
            value=qa('status')
            if predicate(value):return value
            time.sleep(2)
        raise RuntimeError('world_tick_fixture_timeout: '+str(value))
    def natural_growth(label):
        print(json.dumps({'stage':label,'phase':'observing-natural-growth'}),flush=True)
        before=qa('seed')
        after=until(lambda s:s.get('grown',0)>0 and s.get('hydrated',0)>0)
        details[label]={'before':before,'after':after}
        checks[label]=(before.get('grown')==0 and before.get('hydrated')==0
            and after['serverTick']>before['serverTick'] and after['plotForceTicks']
            and not after['plotPlayerNearby'] and after['plants']==63)
        print(json.dumps({'stage':label,'grown':after.get('grown'),'hydrated':after.get('hydrated'),
            'serverTicks':after['serverTick']-before['serverTick'],'passed':checks[label]}),flush=True)
    command('gamerule doMobSpawning false')
    command('gamerule doDaylightCycle false')
    command('time set day')
    command('forceload add 1024 1024')
    initial=qa('setup');details['initial']=initial
    adopted=response('qdmaid companion_adopt '+uuid.uuid4().hex+' '+initial['maidUuid']+' '+initial['ownerUuid'])
    details['adopted']=adopted
    checks['native-adoption']=adopted['ok'] and adopted['phase']=='applied'
    command('forceload remove all')
    ready=until(lambda s:s['plotForceTicks'] and s['plotEntityTicking'] and not s['plotPlayerNearby'],seconds=30)
    details['numenOnlyReady']=ready
    checks['no-real-viewer-and-maid-not-enabled']=not ready['maidTick']['eligible']
    checks['crops-in-adjacent-chunk']=(ready['ownerChunkX']==ready['plotChunkX']
        and ready['ownerChunkZ']==ready['plotChunkZ']+1)
    natural_growth('numen-owner-offline-natural-crop-and-soil-growth')
    online=qa('owner_online');details['onlineOwner']=online
    natural_growth('numen-owner-online-natural-crop-and-soil-growth')
    qa('shift')
    shifted=until(lambda s:not s['oldEdgeForced'] and s['intersectionForced'] and s['newEdgeForced']
        and s['ownerForcedCount']==9 and s['ownerEntityCount']==9,seconds=30)
    details['numenShifted']=shifted
    native=response('numen_autonomy_status','QD_NUMEN_AUTONOMY_JSON ')
    row=next(row for row in native['bodies'] if row['bodyName']=='CompanionQA')
    details['numenShiftedNative']=native
    checks['numen-move-releases-edge-retains-intersection-adds-new-edge']=(row['worldTickChunkX']==65
        and row['worldTickNativeForcedCount']==9 and row['worldTickEntityTickingCount']==9)
    qa('restore')
    details['numenRestored']=until(lambda s:s['oldEdgeForced'] and s['intersectionForced'] and not s['newEdgeForced'],seconds=30)
    maid=qa('maid_only');details['maidOnly']=maid
    ready=until(lambda s:s['maidTick']['eligible'] and s['maidTick']['nativeForceTicks'],seconds=30)
    time.sleep(3)
    native=response('numen_autonomy_status','QD_NUMEN_AUTONOMY_JSON ')
    details['bodyDisabled']=native
    checks['numen-disabled-releases-own-forced-ticket']=not native['bodies'][0]['worldTickTicketActive']
    home=qa('maid_home');details['maidHome']=home
    checks['home-work-remains-eligible']=home['maidHome'] and home['maidTick']['eligible']
    natural_growth('maid-only-natural-crop-and-soil-growth')
    qa('maid_shift')
    shifted=until(lambda s:not s['oldEdgeForced'] and s['intersectionForced'] and s['newEdgeForced']
        and s['maidTick']['worldTickNativeForcedCount']==9 and s['maidTick']['worldTickEntityTickingCount']==9,seconds=30)
    details['maidShifted']=shifted
    checks['maid-move-releases-edge-retains-intersection-adds-new-edge']=shifted['maidHome']
    qa('maid_restore')
    details['maidRestored']=until(lambda s:s['oldEdgeForced'] and s['intersectionForced'] and not s['newEdgeForced'],seconds=30)
    disabled=qa('disable');details['disabled']=disabled
    cleaned=until(lambda s:not s['plotForceTicks'] and s['serverTick']-disabled['serverTick']>45,seconds=35)
    details['cleanup']=cleaned
    checks['both-disabled-remove-forced-ticket']=not cleaned['plotForceTicks'] and cleaned['visitedAreaForcedCount']==0
    command('save-all flush')
    run([*base,'stop','-t','60','mc'],timeout=100)
    for name in ('numen-autonomous-bodies.json','qiandeng-companion-ticking.json'):
        path=data/'config'/name
        policy=json.loads(path.read_text('utf8'));policy['enabled']=False
        path.write_text(json.dumps(policy),'utf8')
    run([*base,'start','mc'],timeout=60)
    deadline=time.monotonic()+180
    while time.monotonic()<deadline:
        try:
            restarted=qa('status')
            if not restarted['plotForceTicks']:break
        except (RuntimeError,ValueError):pass
        time.sleep(3)
    else:raise RuntimeError('disabled_restart_timeout')
    details['restartedDisabled']=restarted
    checks['disabled-restart-does-not-restore-forced-ticket']=not restarted['plotForceTicks'] and restarted['visitedAreaForcedCount']==0
    checks['no-forced-chunks-remain']='No force loaded chunks were found' in command('forceload query')
    checks['normal-random-tick-speed']='3' in command('gamerule randomTickSpeed')
    checks['no-model-or-tts-requests']=not(fake/'requests.jsonl').exists()
