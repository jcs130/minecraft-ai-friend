// Server-only Aincrad beta onboarding. No model calls or public status spam.
ServerEvents.loaded(function (event) {
  event.server.persistentData.putBoolean('tauceti_world', true)
  global.tauceti.tcWorldOk = true
})
var mawTravelRequests = {}

function mawTell(player, action, data) {
  var out = { schemaVersion: 1, action: action, observedAt: new Date().toISOString() }
  for (var key in data) out[key] = data[key]
  player.tell('MC_WORLD ' + JSON.stringify(out))
}

function mawGo(player, kind) {
  if (player == null) return 0
  // Reuse the tower's real no-escape guard. Never bypass a running encounter.
  if (String(player.level.dimension) === 'tauceti:tower') {
    player.tell('试炼进行中，请通过原试炼出口离开。'); return 0
  }
  var pending=mawTravelRequests[String(player.uuid)]
  if (pending && pending.status==='accepted') {
    if (Date.now()>pending.deadline) pending.status='unknown'
    mawTell(player,'travel',{status:pending.status==='accepted'?'busy':'unknown',requestId:pending.requestId,nextSafeRead:'/mycli status'})
    return 0
  }
  if (kind === 'wild') {
    var target = player.server.getLevel('myagentworld:wilderness')
    if (target == null) { player.tell('资源世界尚未就绪，请稍后重试。'); return 0 }
    var previous=mawTravelRequests[String(player.uuid)]
    if (previous && previous.status==='accepted') {
      mawTell(player,'travel',{status:'busy',requestId:previous.requestId,nextSafeRead:'/mycli status'});return 0
    }
    var request={requestId:String(Java.loadClass('java.util.UUID').randomUUID()),status:'accepted',targetDimension:'myagentworld:wilderness',deadline:Date.now()+30000}
    mawTravelRequests[String(player.uuid)]=request
    mawTell(player,'travel',{status:'accepted',requestId:request.requestId,nextSafeRead:'/mycli status'})
    mawPrepareTravel(player,target,request,0,null)
    return 1
  }
  var spawnRequest={requestId:String(Java.loadClass('java.util.UUID').randomUUID()),status:'accepted',targetDimension:'minecraft:overworld',deadline:Date.now()+30000,teleportDispatched:true}
  mawTravelRequests[String(player.uuid)]=spawnRequest
  mawTell(player,'travel',{status:'accepted',requestId:spawnRequest.requestId,nextSafeRead:'/mycli status'})
  player.server.runCommandSilent('execute in minecraft:overworld run tp '+String(player.uuid)+' -582.5 69 934.5')
  player.server.scheduleInTicks(2,function(){mawVerifyTravel(player,'minecraft:overworld',-582.5,69,934.5,spawnRequest,0)})
  return 1
}

function mawTravelReceipt(player, dimension, x, y, z, requestId) {
  var complete=String(player.level.dimension)===dimension && Math.abs(player.x-x)<0.1 && Math.abs(player.y-y)<0.1 && Math.abs(player.z-z)<0.1
  mawTell(player,'travel',{status:complete?'completed':'unconfirmed',requestId:requestId||null,dimension:String(player.level.dimension),position:{x:player.x,y:player.y,z:player.z},requested:{dimension:dimension,x:x,y:y,z:z}})
  return complete?1:0
}

function mawVerifyTravel(player,dimension,x,y,z,request,attempt) {
  try {
    var current=player.server.getPlayerList().getPlayer(player.uuid)
    if (current==null || String(current.connection)!==String(player.connection)) {request.status='unknown';return}
    var complete=String(current.level.dimension)===dimension && Math.abs(current.x-x)<0.1 && Math.abs(current.y-y)<0.1 && Math.abs(current.z-z)<0.1
    if (!complete && attempt<10) {
      player.server.scheduleInTicks(2,function(){mawVerifyTravel(player,dimension,x,y,z,request,attempt+1)})
      return
    }
    request.status=mawTravelReceipt(current,dimension,x,y,z,request.requestId)?'completed':'unconfirmed'
  }catch(error){
    request.status='unknown';request.reason=String(error).slice(0,180)
    mawTell(player,'travel',{status:'unknown',requestId:request.requestId,reason:request.reason,changed:null,nextSafeRead:'/mycli status'})
  }
}

function mawPrepareTravel(player,target,request,index,future) {
  try {
    var current=player.server.getPlayerList().getPlayer(player.uuid)
    if (current==null || !current.equals(player)) {request.status='cancelled';return}
    if (mawTravelRequests[String(player.uuid)]!==request) return
    if (Date.now()>request.deadline) throw 'resource_loading_timeout'
    var points=[[8,0],[0,0],[0,8],[-8,0],[0,-8],[16,16],[-16,-16],[24,0],[0,24]]
    if (index>=points.length) throw 'no_verified_safe_destination'
    var x=points[index][0],z=points[index][1]
    if (future==null) {
      var ChunkStatus=Java.loadClass('net.minecraft.world.level.chunk.status.ChunkStatus')
      future=target.getChunkSource().getChunkFuture(Math.floor(x/16),Math.floor(z/16),ChunkStatus.FULL,true)
    }
    if (!future.isDone()) {
      player.server.scheduleInTicks(5,function(){mawPrepareTravel(player,target,request,index,future)})
      return
    }
    if (future.isCompletedExceptionally() || target.getChunkSource().getChunkNow(Math.floor(x/16),Math.floor(z/16))==null) throw 'resource_chunk_unavailable'
    var height=Java.loadClass('net.minecraft.world.level.levelgen.Heightmap$Types'),BlockPos=Java.loadClass('net.minecraft.core.BlockPos')
    var y=target.getHeight(height.MOTION_BLOCKING_NO_LEAVES,x,z),below=new BlockPos(x,y-1,z),ground=target.getBlockState(below)
    if (!ground.getFluidState().isEmpty() || ground.getCollisionShape(target,below).isEmpty() || !target.getBlockState(new BlockPos(x,y,z)).isAir() || !target.getBlockState(new BlockPos(x,y+1,z)).isAir()) {
      mawPrepareTravel(player,target,request,index+1,null);return
    }
    request.teleportDispatched=true
    player.server.runCommandSilent('execute in myagentworld:wilderness run tp '+String(player.uuid)+' '+(x+0.5)+' '+y+' '+(z+0.5))
    player.server.scheduleInTicks(2,function(){mawVerifyTravel(player,'myagentworld:wilderness',x+0.5,y,z+0.5,request,0)})
  }catch(error){
    request.status=request.teleportDispatched?'unknown':'failed';request.reason=String(error).slice(0,180)
    mawTell(player,'travel',{status:request.status,requestId:request.requestId,reason:request.reason,changed:request.teleportDispatched?null:false,nextSafeRead:'/mycli status'})
  }
}

ServerEvents.commandRegistry(function(event) {
  var commands=event.commands
  function status(ctx) {
    var p=ctx.source.player;if(p==null)return 0
    mawTell(p,'status',{status:'ok',world:'Aincrad beta',playerUuid:String(p.uuid),health:p.health,hunger:p.foodLevel,
      experienceLevel:p.experienceLevel,dimension:String(p.level.dimension),position:{x:p.x,y:p.y,z:p.z},mana:null,
      travel:mawTravelRequests[String(p.uuid)]||null,note:'原生魔力与模组动作请使用当前 SDK operations/mod_operations；这里不提供估算数值。'})
    return 1
  }
  function help(ctx) {
    var p=ctx.source.player;if(p==null)return 0
    mawTell(p,'help',{status:'ok',commands:[
      {command:'/mycli status',description:'本人真实状态及绝对坐标'},
      {command:'/mycli spawn',description:'返回起始之城，试炼中不可逃离'},
      {command:'/mycli wild',description:'自然资源世界：采矿、农业、殖民地和机械建设'},
      {command:'/tower floor',description:'全服塔进度与当前钥匙需求'},
      {command:'/tower',description:'站在起始广场发光方块上进入原生试炼'},
      {command:'/fom inventory',description:'原生物品标识与组件'},
      {command:'/fom nearby',description:'原生附近实体，包括模组实体'}],
      limitations:['公开地图为第一层；塔为波次挑战，不等于百张独立楼层地图。','原 Paper RPG 的职业、工会和技能进度不在本次重置中复制。']})
    return 1
  }
  event.register(commands.literal('mycli').executes(help)
    .then(commands.literal('help').executes(help))
    .then(commands.literal('list').executes(help))
    .then(commands.literal('status').executes(status))
    .then(commands.literal('spawn').executes(function(ctx){return mawGo(ctx.source.player,'spawn')}))
    .then(commands.literal('wild').executes(function(ctx){return mawGo(ctx.source.player,'wild')})))
  event.register(commands.literal('aincrad').executes(function(ctx){return mawGo(ctx.source.player,'spawn')}))
})

PlayerEvents.loggedIn(function(event) {
  var p=event.player
  if (!p.persistentData.getBoolean('maw_aincrad_welcome_v1')) {
    p.persistentData.putBoolean('maw_aincrad_welcome_v1',true)
    p.tell('欢迎来到 My Agent World · 艾恩葛朗特公开测试。/mycli help 查看入口。')
    p.tell('主城探索用 /aincrad；采矿、建殖民地和机械发展用 /mycli wild。')
    p.give(Item.of('minecraft:bread',8))
    p.give('minecraft:wooden_pickaxe');p.give('minecraft:wooden_sword')
    p.give('minecraft:echo_shard')
  }
})
