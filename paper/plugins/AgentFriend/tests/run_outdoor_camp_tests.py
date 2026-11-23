"""Run extracted application methods against offline Java boundaries, NOT an in-game acceptance test.

No Bukkit server, world, player data or external dependencies are used. Record/overlay, admission,
visit, button, HUD, checkpoint and append control flow comes from the current application source.
Bukkit, inventory, durability and definition serialization are synthetic boundary implementations;
source audits separately guard real delivery ordering and final-wave-only settlement.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from run_muster_roster_tests import method


def audit(source, outpost):
    checks = 0
    failures = []

    def check(value, message):
        nonlocal checks
        if value:
            checks += 1
        else:
            failures.append(message)

    def ordered(body, *parts):
        position = -1
        for part in parts:
            found = body.find(part, position + 1)
            check(found >= 0, f"missing/out-of-order application statement: {part}")
            if found >= 0:
                position = found

    restore = method(source, 'private void restore()')
    recovery = method(source, 'private void returnToCheckpoint(Run r)')
    check('r.room().center(world):stored' in recovery, 'new arena recovery must aim at the real combat area, not an approach-edge checkpoint')
    check('r.room().contains(candidate)' in recovery, 'recovery candidate must remain inside current combat bounds')
    check('new int[]{0,-1,1,-2,2}' in recovery, 'recovery searches nearest safe landing before distant offsets')
    check('COMBAT_AREA_RETURN_REQUIRED' in source and 'insideCombatArea' in source, 'out-of-area position is actionable guidance, not an empty-wave stall')
    persist = method(source, 'private void persist(Runnable extra)')
    definition = method(source, 'private String definition(Site site)')
    start = method(source, 'private void start(Player p,Site s,Mode mode,String confirmation)')
    tick = method(source, 'private void tick()')
    complete = method(source, 'private void complete(Run r)')
    settlement = method(source, 'private void completeCamp(Run r)')
    # Overlay selection must remain marker-gated, before the original definition comparison.
    ordered(restore, 'Site site=site(id)', 'if(c.contains("campEncounter"))',
            'require(wildCamp(site)&&c.getInt("campEncounter")==1', 'site=campArena(site)',
            'if(c.contains("arenaWaves"))', 'require(cryptSite(site)&&c.getInt("arenaWaves")==1',
            'site=encounterArena(site)', 'require(definition(site).equals(c.getString("definition"))')
    check('blockedCheckpoints.add(id);ready=false' in restore, 'incompatible checkpoints must fail closed')
    check('definition_changed_checkpoint_preserved' in restore, 'old signature conflicts must be preserved')
    check('if(wildCamp(r.site)&&r.site.rooms.size()==1)saved.put("campEncounter",1)' in persist,
          'only new camp runs persist the camp marker')
    check('if(sameArena(r.site))saved.put("arenaWaves",1)' in persist, 'only same-arena runs persist the wave marker')
    check('encounterArena(' not in definition and 'campArena(' not in definition,
          'definition serializer must not silently overlay old signatures')
    check('if(!site.outdoor)value.remove("outdoor")' in definition and 'object.remove("hint")' in definition,
          'retain legacy signature normalization')
    check('reviewEntry(' not in start and 'confirmation_required' not in start,
          'start must not restore the blocking confirmation gate')
    check('var roster=List.of(starter)' in start and '仍可开场' in start,
          'starter-only roster and equipment notice must remain')
    ordered(start, 's=encounterArena(s)', 'if(wildCamp(s)||sameArena(s)){r.phase="moving";r.readyAt=r.started+4000;}',
            'try{persist();}', 'for(EntryMember member:roster)permit(s,member)', 'inviteMuster(s,p)')
    check(any(gate in tick for gate in (
        'if(sameArena(r.site)&&now<r.readyAt){updateCampBattle(r);continue;}',
        'if((sameArena(r.site)||wildCamp(r.site))&&now<r.readyAt){updateCampBattle(r);continue;}')),
        'wave delay must prevent spawning while updating the HUD')
    overlay = method(source, 'private static Site encounterArena(Site site)')
    check('EncounterDesign.enemies(site.id,i,original.enemies)' in overlay,
          'new crypt runs must apply the authored design to each original wave without changing the source definitions')
    ordered(tick, 'if(r.mobs.isEmpty())', 'r.stage++;r.attempt=0;r.phase=r.stage==r.stages()?"returning":"moving"',
            'if(sameArena(r.site))r.readyAt=now+6000', 'persist();', 'if(r.phase.equals("returning"))complete(r)')
    check(tick.count('complete(r)') == 2 and 'if(r.phase.equals("returning")){complete(r);continue;}' in tick,
          'only returning/final-wave paths may settle')
    check('campOutpost.drop(' not in tick and 'campOutpost.publish(' not in tick,
          'no loot delivery between waves')
    check('if(wildCamp(r.site)&&r.site.rooms.size()==1||sameArena(r.site)){completeCamp(r);return;}' in complete,
          'old room-based runs retain the original settlement path')
    ordered(settlement, 'if(sameArena(r.site)){', 'campOutpost.drop(r.id,', '}else campOutpost.publish(r.id,loot)',
            'end(r,"completed")')
    check('.receipts.' not in settlement and '.claimed-runs.' not in settlement and 'saveOutcome(' not in settlement,
          'new settlement must not overwrite old receipts')
    check('receipt(id,r.site.id)==null' in settlement, 'old receipts must prevent duplicate relic delivery')
    check('siteRewardSlot(r,id,day()).equals("eligible")' in settlement, 'existing per-player daily limits still gate physical loot')
    ordered(settlement, 'if(!plugin.getConfig().contains(plan))', '"recipients",recipients', 'campOutpost.drop(r.id,', 'ROOT+".claimed."+id', 'end(r,"completed")')

    replaceable = method(outpost, 'private static boolean replaceable(Block block)')
    building = method(outpost, 'private void building(World world,String id,List<Cell> cells)')
    ensure = method(outpost, 'void ensure()')
    publish = method(outpost, 'void publish(String run,List<ItemStack> rewards)')
    drop = method(outpost, 'void drop(String run,Location at,List<ItemStack> rewards)')
    check('block.getType().isAir()' in replaceable and 'Material.SHORT_GRASS,Material.TALL_GRASS,Material.FERN' in replaceable,
          'additive construction must only replace air/grass')
    check(ensure.count('building(world,') == 3, 'exactly three additive camp buildings')
    ordered(building, 'if(status.equals("prepared")){', 'return;', 'if(cells.stream().anyMatch(c->!replaceable(',
            'plugin.getConfig().set(path,"prepared");save();', '.setType(c.material,false)',
            'world.save();', 'plugin.getConfig().set(path,"applied");save();')
    check('if(!status.isEmpty())return;' in ensure, 'missing/unknown original chest must not be replaced')
    ordered(ensure, 'if(!replaceable(block)||!AgentFriendPlugin.safeLanding(block)',
            'plugin.getConfig().set(ROOT+".chest.status","prepared");save();', 'block.setType(Material.CHEST,false)')
    for body, error, mutation in [(publish, 'camp_reward_delivery_unconfirmed', '.setContents(after)'),
                                   (drop, 'arena_reward_drop_unconfirmed', '.dropItemNaturally(')]:
        ordered(body, 'UUID.fromString(run)', 'if(status.equals("applied"))return;',
                f'if(status.equals("prepared"))throw new IllegalArgumentException("{error}")',
                'plugin.getConfig().set(path,"prepared");save();', mutation,
                '.save();', 'plugin.getConfig().set(path,"applied");save();')
    ordered(publish, 'if(run.equals(chest.getPersistentDataContainer().get(delivery,PersistentDataType.STRING)))',
            'plugin.getConfig().set(path,"applied");save();return;', 'if(status.equals("prepared"))throw',
            'append(chest.getSnapshotInventory().getContents(),rewards)')
    check('getSnapshotInventory().clear(' not in publish and 'getInventory().clear(' not in outpost,
          'publishing must never clear an old container')
    check('".deliveries."+run' in publish and '".drops."+run' in drop,
          'delivery ledger must be scoped to original run UUID')
    print(f'PASS {checks} outdoor/crypt source structure checks', flush=True)
    for failure in failures:
        print(f'FAIL outdoor/crypt source: {failure}', flush=True)
    if failures:
        raise AssertionError(f'{len(failures)} application source contract failures; Java probe not run')


TEMPLATE = r'''
import java.util.*;
class SiteDungeonManager {
 static int checks;
 static void check(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
 static String thrown(Runnable action){try{action.run();return "";}catch(IllegalArgumentException e){return e.getMessage();}}
 enum EntityType {PILLAGER,VINDICATOR,ZOMBIE,SKELETON,STRAY,WITHER_SKELETON,WITCH,HUSK}
 enum Material {AIR,STONE_BUTTON,CROSSBOW,EMERALD,ARROW,COOKED_BEEF,IRON_INGOT,BREAD,IRON_SWORD;
  boolean isAir(){return this==AIR;}}
 enum GameMode {SURVIVAL,SPECTATOR,CREATIVE,ADVENTURE}
 enum Action {RIGHT_CLICK_BLOCK,LEFT_CLICK_BLOCK}
 enum EquipmentSlot {HAND,OFF_HAND}
 enum BarColor {PURPLE,RED}
 enum BarStyle {SEGMENTED_6,SOLID}
 static class Location implements Cloneable {
  World w;double x,y,z;Location(World w,double x,double y,double z){this.w=w;this.x=x;this.y=y;this.z=z;}
  World getWorld(){return w;}double getX(){return x;}double getY(){return y;}double getZ(){return z;}
  int getBlockX(){return (int)Math.floor(x);}int getBlockY(){return (int)Math.floor(y);}int getBlockZ(){return (int)Math.floor(z);}
  public Location clone(){return new Location(w,x,y,z);}Location add(double dx,double dy,double dz){x+=dx;y+=dy;z+=dz;return this;}
  Block getBlock(){return new Block(w,getBlockX(),getBlockY(),getBlockZ());}
 }
 static class Entity {boolean valid=true,dead;UUID id=new UUID(0,1);UUID getUniqueId(){return id;}boolean isValid(){return valid;}boolean isDead(){return dead;}}
 static class Raider extends Entity {}
 static class Mob extends Raider {double health=120;double getHealth(){return health;}Attr getAttribute(Object a){return new Attr();}}
 static class Attr {double getValue(){return 120;}}
 static class org {static class bukkit {static class attribute {static class Attribute {static final Object GENERIC_MAX_HEALTH=new Object();}}}}
 static class World {
  final String name;List<Entity> entities=new ArrayList<>();World(String name){this.name=name;}String getName(){return name;}
  List<Entity> getNearbyEntities(Location at,double x,double y,double z){return entities;}
 }
 static final World WORLD=new World("world"),OTHER=new World("other");
 static class Bukkit {
  static boolean worldAvailable=true;static Map<UUID,Entity> entities=new HashMap<>();
  static World getWorld(String name){return worldAvailable&&name.equals("world")?WORLD:null;}
  static Entity getEntity(UUID id){return entities.get(id);}
  static BossBar createBossBar(String title,BarColor color,BarStyle style){return new BossBar();}
 }
 static class BossBar {
  String title;double progress;List<Player> players=new ArrayList<>();
  void setTitle(String s){title=s;}void setProgress(double p){progress=p;}
  List<Player> getPlayers(){return players;}void addPlayer(Player p){players.add(p);}void removePlayer(Player p){players.remove(p);}void removeAll(){players.clear();}
 }
 static class SiteRewardPolicy {__REWARD_STATUS__}
 static class DungeonWaveCatalog {record Enemy(EntityType type,double health,String name,String mythic){
  Enemy(EntityType type,double health,String name){this(type,health,name,"");}}}
 static class EncounterDesign {
  static final List<String> NAMES=List.of("前庭交叉火力","毒雾与侧翼","破封守墓者");
  static final List<String> TACTICS=List.of("射线预警","绿色毒雾预警","半血换招");
  __DESIGN_METHODS__
 }
 __RECORDS__
 static class Chunk {} static class Shock {} static class AltarPoison {static final String SITE="altar";}
 static class BeaconLayout {Site site;}
 static class BeaconExpedition {
  static final String SITE="beacon",VERSION="fixture";static final int STAGES=3,BRIEFING=0,CAMP=1;
  enum Stop {FIRST}
  static class Progress {static Progress fresh(){return new Progress();}String save(){return "";}
   static Progress restore(String text,int stage,Set<UUID> players){return new Progress();}Stop stop(int stage){return Stop.FIRST;}}
 }
 static class EchoCitadel {static final String SITE="echo";static final int VERSION=1;
  static class Progress {Map<String,Object> timing(){return Map.of();}void restore(long b,long t,long w,List<Integer> seen){}}}
 static class Player {
  final UUID id;Location loc;boolean online=true,dead,observer,resident,downed,vehicle,dungeon,pvp;
  GameMode mode=GameMode.SURVIVAL;List<String> messages=new ArrayList<>();
  Player(int n,Location loc){id=new UUID(0,n);this.loc=loc;}UUID getUniqueId(){return id;}Location getLocation(){return loc;}
  World getWorld(){return loc.w;}boolean isOnline(){return online;}boolean isDead(){return dead;}GameMode getGameMode(){return mode;}
  boolean isInsideVehicle(){return vehicle;}void sendMessage(String s){messages.add(s);}void sendTitle(String a,String b,int i,int s,int o){messages.add(a+b);}
 }
 static class ResidentCli {
  static List<Player> players=new ArrayList<>();static List<Player> online(){return players;}
  static Player find(UUID id){return players.stream().filter(p->p.id.equals(id)&&p.online).findFirst().orElse(null);}
  static boolean isResident(UUID id){return players.stream().anyMatch(p->p.id.equals(id)&&p.resident);}
 }
 // Synthetic configuration/durability boundary; application persist/restore bodies are unmodified.
 static class Config {
  final Map<String,Object> data;Config(){this(new LinkedHashMap<>());}Config(Map<String,Object> data){this.data=data;}
  Object get(String path){Object node=data;for(String key:path.split("\\.")){if(!(node instanceof Map<?,?> map))return null;node=map.get(key);}return node;}
  boolean contains(String path){return get(path)!=null;}
  @SuppressWarnings("unchecked") void set(String path,Object value){String[] keys=path.split("\\.");Map<String,Object> node=data;
   for(int i=0;i<keys.length-1;i++){Object old=node.get(keys[i]);if(!(old instanceof Map)){old=new LinkedHashMap<String,Object>();node.put(keys[i],old);}node=(Map<String,Object>)old;}
   if(value==null)node.remove(keys[keys.length-1]);else node.put(keys[keys.length-1],value);}
  @SuppressWarnings("unchecked") Config getConfigurationSection(String key){Object v=get(key);return v instanceof Map?new Config((Map<String,Object>)v):null;}
  Config createSection(String key,Map<String,?> values){var map=new LinkedHashMap<String,Object>(values);set(key,map);return new Config(map);}
  Set<String> getKeys(boolean deep){return data.keySet();}
  String getString(String key){return getString(key,null);}String getString(String key,String fallback){Object v=get(key);return v==null?fallback:v.toString();}
  int getInt(String key){return getInt(key,0);}int getInt(String key,int fallback){Object v=get(key);return v instanceof Number n?n.intValue():fallback;}
  long getLong(String key){return getLong(key,0);}long getLong(String key,long fallback){Object v=get(key);return v instanceof Number n?n.longValue():fallback;}
  boolean getBoolean(String key,boolean fallback){Object v=get(key);return v instanceof Boolean b?b:fallback;}
  List<String> getStringList(String key){Object v=get(key);return v instanceof List<?> list?list.stream().map(Object::toString).toList():List.of();}
  List<Integer> getIntegerList(String key){Object v=get(key);return v instanceof List<?> list?list.stream().map(x->((Number)x).intValue()).toList():List.of();}
  Location getLocation(String key){return (Location)get(key);}
 }
 static class Edits {Set<String> failures=new HashSet<>(),pending=new HashSet<>();boolean failed(String key){return failures.contains(key);}boolean dirty(String key){return pending.contains(key);}}
 static class Plugin {
  Config config=new Config();Edits edits=new Edits();Config getConfig(){return config;}Edits dungeonEdits(){return edits;}
  boolean isDowned(Player p){return p.downed;}boolean isObserver(Player p){return p.observer;}boolean trustedBlockEditor(Player p){return true;}
  boolean dungeonParticipant(Player p){return p.dungeon;}boolean pvpParticipant(Player p){return p.pvp;}
  java.util.logging.Logger getLogger(){return java.util.logging.Logger.getLogger("offline-checkpoint-probe");}
  void nativeSiteCompleted(Player p,String site,String run){}boolean nativeRpgSelected(){return false;}Assessments skillAssessments(){return null;}
  TaskMarket taskMarket(){return new TaskMarket();}
 }
 static class GuildManager {enum Goal {SITE_CLEAR}}
 static class TaskMarket {void worldAction(Player p,GuildManager.Goal goal,String site,String context,long started,boolean notify){}}
 static class Assessments {void siteCompleted(Player p,String site,String run,long at){}}
 static class AgentFriendPlugin {static boolean safeLanding(Block b){return true;}}
 static class BlackBannerCamp {static final String SITE="illager_camp";}
 static class DungeonRelics {
  record Relic(int x,int y,int z){}static Map<String,Relic> relics=new HashMap<>();static Relic at(String id){return relics.get(id);}
  static ItemStack create(Relic r,int mode,java.util.Random random){return new ItemStack(Material.IRON_SWORD,1);}
 }
 static class Station {final List<Integer> button;Station(int x,int y,int z){button=List.of(x,y,z);}List<Integer> button(){return button;}}
 static class Block {
  final World w;final int x,y,z;Material type=Material.STONE_BUTTON;
  Block(World w,int x,int y,int z){this.w=w;this.x=x;this.y=y;this.z=z;}World getWorld(){return w;}
  int getX(){return x;}int getY(){return y;}int getZ(){return z;}Material getType(){return type;}
 }
 static class PlayerInteractEvent {
  final Player p;Block block;boolean cancelled;EquipmentSlot hand=EquipmentSlot.HAND;Action action=Action.RIGHT_CLICK_BLOCK;
  PlayerInteractEvent(Player p,Block b){this.p=p;block=b;}Block getClickedBlock(){return block;}EquipmentSlot getHand(){return hand;}
  Action getAction(){return action;}Player getPlayer(){return p;}void setCancelled(boolean c){cancelled=c;}
 }
 // ItemStack is a synthetic amount/stack-size/clone boundary. append is the real CampOutpost body.
 static class ItemStack implements Cloneable {
  Material type;int amount,max;Map<String,String> meta=new HashMap<>();
  ItemStack(Material type,int amount){this(type,amount,type==Material.IRON_SWORD?1:64);}ItemStack(Material type,int amount,int max){this.type=type;this.amount=amount;this.max=max;}
  int getAmount(){return amount;}int getMaxStackSize(){return max;}void setAmount(int n){amount=n;}Material getType(){return type;}
  public ItemStack clone(){var copy=new ItemStack(type,amount,max);copy.meta.putAll(meta);return copy;}
 }
 static class CampOutpost {
  int ensured,published,dropped;String deliveredRun;Location dropPoint;List<ItemStack> loot;
  void ensure(){ensured++;}List<Integer> chestPoint(){return List.of(-1080,67,-1113);}
  void publish(String run,List<ItemStack> rewards){published++;deliveredRun=run;loot=rewards;}
  void drop(String run,Location at,List<ItemStack> rewards){dropped++;deliveredRun=run;dropPoint=at;loot=rewards;}
  __APPEND__
 }
 static final String ROOT="site-dungeons";static final int PARTY_LIMIT=40,HISTORY_LIMIT=1024,MAX_FAILURES=3;static final long TIMEOUT_MS=1800000;
 static final Map<String,Object> BOSS_SKILLS=Map.of();
 Map<String,Run> runs=new LinkedHashMap<>();Map<String,Site> sites=new LinkedHashMap<>();Set<UUID> campVisits=new HashSet<>(),passages=new HashSet<>();Set<String> blockedCheckpoints=new HashSet<>();
 Map<String,Set<UUID>> waveVisits=new HashMap<>();Map<String,BossBar> campBars=new HashMap<>();Map<String,Station> stations=new HashMap<>();
 Map<UUID,Integer> designedPhases=new HashMap<>();
 Plugin plugin=new Plugin();CampOutpost campOutpost=new CampOutpost();BeaconLayout beaconLayout;boolean ready=true;int starts,joins,statuses,menus;
 Site site(String id){Site s=sites.get(id);require(s!=null,"unknown_dungeon");return s;}
 boolean atFirstRoom(Site s,Location l){return s.contains(l)&&s.rooms.getFirst().contains(l);}
 Run own(Player p){return runs.values().stream().filter(r->r.party.contains(p.id)).findFirst().orElse(null);}
 Config receipt(UUID id,String site){return plugin.config.getConfigurationSection(ROOT+".receipts."+id+"."+site);}
 Station station(Site s){return stations.get(s.id);}World entryWorld(Site s){return Bukkit.getWorld(s.world);}
 void require(boolean b,String reason){if(!b)throw new IllegalArgumentException(reason);}
 void updateDesignedBosses(Run r){} // Combat AI is verified separately by real design/move and in-game tests.
 void openDifficulty(Player p,Site s){menus++;}
 void status(Player p,String id){statuses++;}void open(Player p,String id){menus++;}
 void command(Player p,String[] args){
  if(args[1].equals("start")&&args.length<=3){openDifficulty(p,encounterArena(site(args[2])));return;}
  if(args[1].equals("start")){require(musterAdmission(site(args[2]),p).isEmpty(),"inadmissible synthetic start");
   require(!runs.containsKey(args[2]),"duplicate synthetic start");Run r=new Run(encounterArena(site(args[2])),Mode.NORMAL);r.party.add(p.id);runs.put(args[2],r);starts++;}
  else if(args[1].equals("join")){runs.get(args[2]).party.add(p.id);joins++;}
  else if(args[1].equals("claim")){statuses++;}
  else if(args[1].equals("enter")){throw new AssertionError("unexpected station enter");}
  else throw new AssertionError("unexpected command "+Arrays.toString(args));
 }
 List<Player> present(Run r){return ResidentCli.online().stream().filter(p->r.site.contains(p.loc)).toList();}
 void atomic(Runnable change){change.run();}String definition(Site s){return s.toString();}String beaconLayoutSignature(BeaconLayout b){return "fixture";}
 boolean echoGeometry(Site s){return false;}long activeMillis(long start,long pause,long now){return now-start-pause;}
 void end(Run r,String reason){runs.remove(r.site.id);}List<Location> safeSpots(Run r){return List.of(r.room().center(WORLD));}
 String day(){return "2026-11-23";}
 boolean relicClaimed(UUID id,String site){return plugin.config.contains(relicPath(id,site));}String relicPath(UUID id,String site){return ROOT+".relics."+id+"."+site;}
 List<String> missingRooms(Run r,UUID id){return List.of();}List<String> unverifiedRooms(Run r){return List.of();}
 __METHODS__
 static Site camp(){
  var guard=new DungeonWaveCatalog.Enemy(EntityType.PILLAGER,24,"old guard");var boss=new DungeonWaveCatalog.Enemy(EntityType.VINDICATOR,74,"old boss","QD_Blackbanner_Warlord");
  var first=new Room("林缘外哨",-1077,67,-1117,4,List.of(guard,guard),List.of(List.of(-1077,67,-1113)),"old first hint");
  var last=new Room("营火阵地",-1069,67,-1116,5,List.of(guard,boss),List.of(List.of(-1065,67,-1117)),"old last hint");
  return makeSite("illager_camp",List.of(first,last),true);
 }
 static Site makeSite(String id,List<Room> rooms,boolean outdoor){return new Site(id,id,"old expedition","old hint",Material.CROSSBOW,"world",rooms,4,Material.IRON_INGOT,8,List.of(-1080,68,-1117),outdoor,0,1);}
 static Site crypt(String id){
  var first=new Room("first",100,64,200,7,List.of(new DungeonWaveCatalog.Enemy(EntityType.ZOMBIE,20,"first zombie")),List.of(List.of(102,64,202)),"first hint");
  var middle=new Room("middle",120,65,220,5,List.of(new DungeonWaveCatalog.Enemy(EntityType.SKELETON,30,"archer"),new DungeonWaveCatalog.Enemy(EntityType.ZOMBIE,32,"guard")),List.of(List.of(121,65,221)),"middle hint");
  var last=new Room("last",140,66,240,4,List.of(new DungeonWaveCatalog.Enemy(EntityType.VINDICATOR,90,"crypt boss","original_mythic")),List.of(List.of(141,66,241)),"last hint");
  return makeSite(id,List.of(first,middle,last),false);
 }
 static Player actor(int n,Site s){return new Player(n,encounterArena(s).rooms.getFirst().center(WORLD));}
 static void metadata(Site a,Site b){check(a.id.equals(b.id)&&a.name.equals(b.name)&&a.expedition.equals(b.expedition)&&a.icon==b.icon&&a.world.equals(b.world)&&a.emeralds==b.emeralds&&a.bonus==b.bonus&&a.bonusCount==b.bonusCount&&a.entry.equals(b.entry)&&a.outdoor==b.outdoor&&a.conquestFloor==b.conquestFloor&&a.minimumLevel==b.minimumLevel,"overlay must preserve site reward/entry metadata");}
 static void overlays(){
  Site original=camp();String before=original.toString();Site arena=campArena(original);metadata(original,arena);
  check(arena.rooms.size()==1&&arena.rooms.getFirst().enemies.size()==12,"camp 12 enemies in one arena");
  var enemies=arena.rooms.getFirst().enemies;
  check(enemies.stream().filter(e->e.type()==EntityType.PILLAGER&&e.health()==28&&e.mythic().isEmpty()).count()==8,"8 pillagers, 28 HP");
  check(enemies.stream().filter(e->e.type()==EntityType.VINDICATOR&&e.health()==44&&e.mythic().isEmpty()).count()==3,"3 assault vindicators, 44 HP");
  check(enemies.getLast().health()==120&&enemies.getLast().mythic().equals("QD_Blackbanner_Warlord"),"original mythic boss at 120 HP");
  check(arena.rooms.getFirst().spawnPoints.isEmpty()&&arena.rooms.getFirst().radius==14,"new camp arena geometry");
  check(original.toString().equals(before)&&original.rooms.getLast().enemies.getLast().health()==74,"original camp definition unchanged");
  check(campArena(arena)==arena&&encounterArena(arena)==arena,"camp overlay idempotent");
  check(!wildCamp(null)&&campArena(null)==null&&encounterArena(null)==null,"null camp overlay safe");
  Site changed=makeSite(original.id,List.of(new Room("moved",0,67,0,4,List.of(),List.of(),""),original.rooms.getLast()),true);
  check(campArena(changed)==changed,"unknown surveyed camp geometry never overlaid");
  Site interior=makeSite(original.id,original.rooms,false);check(campArena(interior)==interior,"camp ID alone not enough");
  Site ordinary=crypt("frost_keep");check(encounterArena(ordinary)==ordinary&&!cryptSite(ordinary)&&!sameArena(ordinary),"ordinary dungeon untouched");
  check(!cryptSite(null)&&!sameArena(null),"null crypt predicates");
  for(String id:List.of("undead_crypt","creeping_crypt")){
   Site old=crypt(id);String snapshot=old.toString();Site waves=encounterArena(old);metadata(old,waves);
   check(cryptSite(old)&&!sameArena(old)&&sameArena(waves),"crypt overlay selection "+id);
   check(waves.rooms.size()==3&&encounterArena(waves)==waves&&campArena(old)==old,"three idempotent crypt waves "+id);
   for(int i=0;i<3;i++){Room wave=waves.rooms.get(i),nativeRoom=old.rooms.get(i),first=old.rooms.getFirst();
    check(wave.x==first.x&&wave.y==first.y&&wave.z==first.z&&wave.radius==first.radius,"all waves in original first room "+id+"/"+i);
    check(wave.enemies.equals(EncounterDesign.enemies(id,i,nativeRoom.enemies)),"new wave uses real authored role/health profile "+id+"/"+i);
    check(wave.spawnPoints.isEmpty()&&!nativeRoom.spawnPoints.isEmpty(),"do not reuse remote-room spawn points "+id+"/"+i);
   }
   check(old.toString().equals(snapshot),"crypt original definition unchanged "+id);
  }
 }
 static void localIds(){
  for(String id:List.of("illager_camp","undead_crypt","creeping_crypt")){
   Site s=id.equals("illager_camp")?camp():crypt(id);SiteDungeonManager m=new SiteDungeonManager();m.sites.put(id,s);Player p=actor(1,s);
   for(String verb:List.of("start","join","claim","info","menu")){
    check(Arrays.equals(m.localCampCommand(p,new String[]{"dungeon",verb}),new String[]{"dungeon",verb,id}),"infer bare "+verb+"/"+id);
    check(Arrays.equals(m.localCampCommand(p,new String[]{"dungeon",verb,"--json"}),new String[]{"dungeon",verb,id,"--json"}),"retain flags "+verb+"/"+id);
    String[] explicit={"dungeon",verb,"frost_keep","--json"};check(m.localCampCommand(p,explicit)==explicit,"explicit ID never rewritten");
   }
   for(String mode:List.of("normal","adventure","apocalypse"))check(Arrays.equals(m.localCampCommand(p,new String[]{"dungeon","start",mode,"--json"}),new String[]{"dungeon","start",id,mode,"--json"}),"retain difficulty "+mode);
   String[] unsupported={"dungeon","status"},shortArgs={"dungeon"},invalid={"dungeon","start","typo"};
   check(m.localCampCommand(p,unsupported)==unsupported&&m.localCampCommand(p,shortArgs)==shortArgs&&m.localCampCommand(p,invalid)==invalid,"unsupported/short/explicit unknown untouched");
   p.loc=new Location(WORLD,5000,64,5000);String[] bare={"dungeon","start"};check(m.localCampCommand(p,bare)==bare,"outside any arena, no guess");
   p.loc=encounterArena(s).rooms.getFirst().center(OTHER);check(m.localCampCommand(p,bare)==bare,"wrong world, no guess");
  }
  SiteDungeonManager m=new SiteDungeonManager();Site camp=camp();m.sites.put(camp.id,camp);
  Site overlap=makeSite("undead_crypt",campArena(camp).rooms,false);m.sites.put(overlap.id,overlap);Player p=actor(1,camp);
  String[] bare={"dungeon","start"};check(m.localCampCommand(p,bare)==bare,"ambiguous supported arenas, no guess");
  String[] explicit={"dungeon","start","illager_camp"};check(m.localCampCommand(p,explicit)==explicit,"explicit ID survives ambiguous location");
 }
 static void victoriesAndButtons(){
  SiteDungeonManager m=new SiteDungeonManager();Site old=camp(),arena=campArena(old);m.sites.put(old.id,old);Player p=actor(1,old);
  check(!m.campVictory(null)&&!m.campVictory(old),"no victory without clear evidence");Run run=new Run(arena,Mode.NORMAL);m.runs.put(old.id,run);
  check(!m.campVictory(old),"active uncleared run");run.stage=run.stages();check(m.campVictory(old),"cleared current run");
  run.invalid=true;check(!m.campVictory(old),"invalid run never victory");run.invalid=false;run.fault="data_unavailable";check(!m.campVictory(old),"fault run never victory");run.fault="";
  Raider live=new Raider();WORLD.entities=List.of(live);check(!m.campVictory(old),"live nearby raider prevents victory");live.dead=true;check(m.campVictory(old),"dead raider ignored");live.dead=false;live.valid=false;check(m.campVictory(old),"invalid raider ignored");
  WORLD.entities=List.of(new Entity());check(m.campVictory(old),"existing NPC/non-raider not a combat target");WORLD.entities=List.of();
  Bukkit.worldAvailable=false;check(!m.campVictory(old),"missing world prevents victory");Bukkit.worldAvailable=true;m.runs.clear();
  m.plugin.config.set(ROOT+".last-outcomes."+old.id+".reason","completed");m.plugin.config.set(ROOT+".last-outcomes."+old.id+".clearedRooms",1);
  check(m.campVictory(old),"persisted completed outcome");m.plugin.config.set(ROOT+".last-outcomes."+old.id+".clearedRooms",0);check(!m.campVictory(old),"zero cleared rooms not victory");
  m.plugin.config.set(ROOT+".last-outcomes."+old.id+".clearedRooms",1);m.plugin.config.set(ROOT+".last-outcomes."+old.id+".reason","failed");check(!m.campVictory(old),"failed outcome not victory");
  check(!m.bossLocked(new Run(arena,Mode.NORMAL)),"camp boss never room-locks");
  for(String id:List.of("undead_crypt","creeping_crypt")){Run r=new Run(encounterArena(crypt(id)),Mode.NORMAL);r.stage=2;r.phase="fighting";check(!m.bossLocked(r),"same arena boss never room-locks");}
  Run legacy=new Run(crypt("undead_crypt"),Mode.NORMAL);legacy.stage=2;legacy.phase="fighting";check(m.bossLocked(legacy),"old room-style boss lock retained");legacy.phase="returning";check(!m.bossLocked(legacy),"legacy lock phase-limited");
  m.plugin.config=new Config();DungeonRelics.relics.put(old.id,new DungeonRelics.Relic(-1080,68,-1116));Block button=new Block(WORLD,-1080,68,-1116);
  check(m.station(old)==null,"probe native camp button has no station");PlayerInteractEvent event=new PlayerInteractEvent(p,button);m.approachButton(event);
  check(event.cancelled&&m.starts==0&&m.menus==1,"native stone button offers difficulty without station; no battle before choice");
  m.command(p,new String[]{"dungeon","start",old.id,"normal"});
  event=new PlayerInteractEvent(p,button);m.approachButton(event);check(event.cancelled&&m.starts==1&&m.statuses==1,"repeat button reports existing run");
  for(int variant=0;variant<5;variant++){event=new PlayerInteractEvent(p,button);if(variant==0)event.hand=EquipmentSlot.OFF_HAND;if(variant==1)event.action=Action.LEFT_CLICK_BLOCK;if(variant==2)event.block=null;if(variant==3)event.block=new Block(WORLD,0,0,0);if(variant==4){event.block=new Block(WORLD,-1080,68,-1116);event.block.type=Material.AIR;}m.approachButton(event);check(!event.cancelled&&m.starts==1,"invalid native button event "+variant);}
  for(String id:List.of("undead_crypt","creeping_crypt")){
   SiteDungeonManager c=new SiteDungeonManager();Site s=crypt(id);c.sites.put(id,s);DungeonRelics.relics.put(id,new DungeonRelics.Relic(100,64,200));
   event=new PlayerInteractEvent(actor(20,s),new Block(WORLD,100,64,200));c.approachButton(event);check(event.cancelled&&c.starts==0&&c.menus==1,"native crypt button offers difficulty without station "+id);
  }
  DungeonRelics.relics.clear();
 }
 static void tickVisit(SiteDungeonManager m,boolean camp){if(camp)m.tickOutdoorCamp();else m.tickCryptWaves();}
 static Set<UUID> visited(SiteDungeonManager m,Site s,boolean camp){return camp?m.campVisits:m.waveVisits.getOrDefault(s.id,Set.of());}
 static void visits(){
  for(String id:List.of("illager_camp","undead_crypt","creeping_crypt")){
   boolean outdoor=id.equals("illager_camp");Site s=outdoor?camp():crypt(id);SiteDungeonManager m=new SiteDungeonManager();m.sites.put(id,s);
   Player actor=actor(1,s),second=actor(2,s),spectator=actor(3,s),resident=actor(4,s),downed=actor(5,s),dungeon=actor(6,s),pvp=actor(7,s),own=actor(8,s),vehicle=actor(9,s),passage=actor(10,s),observer=actor(11,s),creative=actor(12,s);
   spectator.mode=GameMode.SPECTATOR;resident.resident=true;downed.downed=true;dungeon.dungeon=true;pvp.pvp=true;vehicle.vehicle=true;observer.observer=true;creative.mode=GameMode.CREATIVE;m.passages.add(passage.id);
   Run elsewhere=new Run(crypt("frost_keep"),Mode.NORMAL);elsewhere.party.add(own.id);m.runs.put(elsewhere.site.id,elsewhere);
   List<Player> excluded=List.of(spectator,resident,downed,dungeon,pvp,own,vehicle,passage,observer,creative);
   ResidentCli.players=new ArrayList<>(excluded);m.ready=false;tickVisit(m,outdoor);check(m.starts==0,"not ready cannot auto-start "+id);m.ready=true;
   tickVisit(m,outdoor);check(m.starts==0,"only excluded players cannot auto-start "+id);
   ResidentCli.players.add(actor);ResidentCli.players.add(second);tickVisit(m,outdoor);
   check(m.starts==0&&m.menus==2&&!m.runs.containsKey(id),"difficulty choice is visible and no battle starts before choice "+id);
   m.command(actor,new String[]{"dungeon","start",id,"normal"});
   check(m.starts==1&&m.runs.get(id).party.equals(Set.of(actor.id)),"one original run after explicit difficulty choice "+id);
   check(visited(m,s,outdoor).containsAll(List.of(actor.id,second.id)),"mark visits during active run "+id);
   tickVisit(m,outdoor);check(m.starts==1&&m.joins==0,"standing visit deduplicated "+id);
   m.runs.remove(id);tickVisit(m,outdoor);check(m.starts==1,"finished run not replayed while standing "+id);
   for(Player p:ResidentCli.players)p.loc=new Location(WORLD,5000,64,5000);tickVisit(m,outdoor);check(visited(m,s,outdoor).isEmpty(),"physical exit clears visit set "+id);
   actor.loc=encounterArena(s).rooms.getFirst().center(WORLD);tickVisit(m,outdoor);check(m.starts==1&&m.menus==3,"physical re-entry offers a new difficulty choice without replay "+id);
   m.command(actor,new String[]{"dungeon","start",id,"normal"});check(m.starts==2,"new visit starts only after choice "+id);
   actor.online=false;tickVisit(m,outdoor);check(!visited(m,s,outdoor).contains(actor.id),"offline visitor removed safely "+id);
   // With no running arena, admission blockers must remain retryable, without consuming a visit.
   m=new SiteDungeonManager();m.sites.put(id,s);actor=actor(1,s);ResidentCli.players=new ArrayList<>(List.of(actor));
   m.plugin.config.set(ROOT+".cooldowns."+id,System.currentTimeMillis());tickVisit(m,outdoor);check(m.starts==0&&!visited(m,s,outdoor).contains(actor.id),"cooldown no auto-start/visit consumption "+id);
   m.plugin.config.set(ROOT+".cooldowns."+id,0);m.plugin.edits.pending.add("site-"+id);tickVisit(m,outdoor);check(m.starts==0,"pending edit blocks auto-start "+id);
   m.plugin.edits.pending.clear();if(outdoor){m.plugin.edits.failures.add("site-"+id);tickVisit(m,true);check(m.starts==0,"camp failed edit blocks auto-start");m.plugin.edits.failures.clear();}
   m.plugin.config.createSection(ROOT+".receipts."+actor.id+"."+id,Map.of("run","old"));tickVisit(m,outdoor);check(m.starts==0,"old receipt blocks auto-start "+id);
   m.plugin.config.set(ROOT+".receipts."+actor.id+"."+id,null);tickVisit(m,outdoor);check(m.starts==0&&m.menus==1,"admission recovery offers one choice "+id);
  }
  ResidentCli.players=new ArrayList<>();
 }
 static void checkpoints(){
  for(String id:List.of("illager_camp","undead_crypt","creeping_crypt"))for(boolean overlay:List.of(false,true)){
   Site original=id.equals("illager_camp")?camp():crypt(id),view=overlay?encounterArena(original):original;SiteDungeonManager m=new SiteDungeonManager();m.sites.put(id,original);
   Run r=new Run(view,Mode.NORMAL);UUID member=new UUID(0,40);r.party.add(member);r.attendance.put(member,1);r.stage=1;r.phase="fighting";r.checkpointRoom=1;r.checkpoint=view.rooms.getFirst().center(WORLD);m.runs.put(id,r);
   String oldReceipt=ROOT+".receipts."+member+"."+id;m.plugin.config.createSection(oldReceipt,Map.of("run","old-receipt","count",7));m.plugin.config.set("old-box.items",List.of("original"));
   m.persist(()->{});Config saved=m.plugin.config.getConfigurationSection(ROOT+".runs."+id);
   check(saved.contains("campEncounter")== (overlay&&id.equals("illager_camp")),"camp marker only on new run "+id+"/"+overlay);
   check(saved.contains("arenaWaves")== (overlay&&!id.equals("illager_camp")),"wave marker only on new run "+id+"/"+overlay);
   check(saved.getString("definition").equals(m.definition(view)),"persist selected definition "+id);
   String snapshot=m.plugin.config.data.toString();m.runs.clear();m.restore();Run restored=m.runs.get(id);
   check(m.ready&&m.blockedCheckpoints.isEmpty()&&restored!=null&&restored.site.equals(view),"real restore selects marker-gated view "+id+"/"+overlay);
   check(restored.stage==1&&restored.id.equals(r.id)&&restored.attendance.get(member)==1,"restore keeps run/stage/attendance "+id);
   check(m.plugin.config.data.toString().equals(snapshot)&&m.plugin.config.getString(oldReceipt+".run").equals("old-receipt"),"restore never rewrites old checkpoint/receipt/box "+id);
  }
  for(int variant=0;variant<7;variant++){
   SiteDungeonManager m=new SiteDungeonManager();Site s=variant==2||variant==6?crypt("undead_crypt"):camp();m.sites.put(s.id,s);Run r=new Run(s,Mode.NORMAL);UUID id=new UUID(0,55);r.party.add(id);r.attendance.put(id,0);m.runs.put(s.id,r);m.persist(()->{});m.runs.clear();
   Config saved=m.plugin.config.getConfigurationSection(ROOT+".runs."+s.id);
   if(variant==0){saved.set("campEncounter",2);saved.set("definition",m.definition(encounterArena(s)));}
   if(variant==1)saved.set("arenaWaves",1);if(variant==2)saved.set("campEncounter",1);
   if(variant==3){saved.set("campEncounter",1);m.sites.put(s.id,makeSite(s.id,List.of(s.rooms.getLast(),s.rooms.getFirst()),true));}
   if(variant==4)saved.set("definition","incompatible old signature");if(variant==5)saved.set("campEncounter",1);
   if(variant==6){saved.set("arenaWaves",2);saved.set("definition",m.definition(encounterArena(s)));}
   String snapshot=m.plugin.config.data.toString();m.restore();
   check(!m.ready&&m.blockedCheckpoints.contains(s.id)&&!m.runs.containsKey(s.id),"incompatible checkpoint fails closed "+variant);
   check(m.plugin.config.data.toString().equals(snapshot),"unknown/incompatible checkpoint not rewritten "+variant);
   check(thrown(()->m.persist(()->{})).equals("checkpoint_conflict_requires_operator")&&m.plugin.config.data.toString().equals(snapshot),"blocked checkpoint cannot be erased by persist "+variant);
  }
 }
 static void hudAndSettlement(){
  for(String id:List.of("undead_crypt","creeping_crypt")){
   SiteDungeonManager m=new SiteDungeonManager();Run r=new Run(encounterArena(crypt(id)),Mode.NORMAL);Player p=actor(1,r.site),observer=actor(2,r.site),resident=actor(3,r.site);observer.mode=GameMode.SPECTATOR;resident.resident=true;ResidentCli.players=new ArrayList<>(List.of(p,observer,resident));
   r.stage=1;r.phase="fighting";r.mobs.put(new UUID(0,1),r.room().enemies.getFirst());m.updateCampBattle(r);BossBar bar=m.campBars.get(r.id);
   check(bar.title.contains("2/3波")&&bar.title.contains("剩余 1")&&bar.progress==.5,"wave/remaining HUD uses current Enemy count "+id);
   check(bar.players.equals(List.of(p,observer)),"spectator sees HUD without participating; residents remain excluded "+id);
   r.phase="moving";m.updateCampBattle(r);check(bar.title.contains("下一波准备中")&&bar.progress==1,"inter-wave HUD "+id);
   p.loc=new Location(WORLD,5000,64,5000);m.updateCampBattle(r);check(bar.players.equals(List.of(observer)),"HUD removes departed viewers, retains on-site spectator "+id);
   r.stage=3;r.phase="returning";r.attendance.put(p.id,3);r.roomAttendance.put(2,Set.of(p.id));m.runs.put(id,r);m.completeCamp(r);
   check(m.campOutpost.dropped==1&&m.campOutpost.published==0&&m.campOutpost.deliveredRun.equals(r.id),"real settlement selects on-site drop with original run UUID "+id);
   check(m.campOutpost.dropPoint.x==100.5&&m.campOutpost.dropPoint.z==200.5,"crypt loot remains in first-room arena "+id);
   check(!m.runs.containsKey(id),"final settlement ends original run "+id);
  }
  SiteDungeonManager m=new SiteDungeonManager();Run r=new Run(campArena(camp()),Mode.NORMAL);Player member=actor(90,r.site);
  ResidentCli.players=new ArrayList<>(List.of(member));r.party.add(member.id);r.attendance.put(member.id,1);r.roomAttendance.put(0,Set.of(member.id));
  r.stage=1;r.phase="returning";m.runs.put(r.site.id,r);m.completeCamp(r);
  check(m.campOutpost.published==1&&m.campOutpost.dropped==0&&m.campOutpost.deliveredRun.equals(r.id),"real camp settlement selects shared chest batch");
  check(m.campOutpost.loot.stream().anyMatch(i->i.type==Material.ARROW&&i.amount==32),"camp shared loot includes arrows");
  check(m.plugin.config.getString(ROOT+".claimed."+member.id+"."+r.site.id).equals(m.day()),"original per-player daily reward cap retained");
  Run repeat=new Run(campArena(camp()),Mode.NORMAL);repeat.stage=1;repeat.phase="returning";repeat.party.add(member.id);repeat.attendance.put(member.id,1);repeat.roomAttendance.put(0,Set.of(member.id));
  m.runs.put(repeat.site.id,repeat);m.completeCamp(repeat);check(m.campOutpost.loot.isEmpty(),"new physical visit does not bypass the existing daily reward cap");
  ResidentCli.players=new ArrayList<>();
 }
 static void appendItems(){
  ItemStack old=new ItemStack(Material.EMERALD,10);old.meta.put("owner","original-player");ItemStack reward=new ItemStack(Material.EMERALD,130);
  ItemStack[] before={old,null,null,null};ItemStack[] after=CampOutpost.append(before,List.of(reward));
  check(before[0]==old&&before[1]==null&&old.amount==10&&reward.amount==130,"append never mutates old slots or reward input");
  check(after[0]!=old&&after[0].amount==10&&after[0].meta.equals(old.meta),"old occupied slot cloned intact, not cleared/merged");
  check(after[1].amount==64&&after[2].amount==64&&after[3].amount==2,"oversized rewards split by max stack size");
  after[0].meta.put("owner","changed-copy");check(old.meta.get("owner").equals("original-player"),"old metadata independent of output clone");
  ItemStack[] noRewards=CampOutpost.append(new ItemStack[]{old,null},List.of());check(noRewards[0].amount==10&&noRewards[1]==null,"empty rewards retain old items/empty slots");
  ItemStack air=new ItemStack(Material.AIR,1);ItemStack[] airBefore={old,air,null};ItemStack[] split=CampOutpost.append(airBefore,List.of(new ItemStack(Material.ARROW,20,16)));
  check(split[0].amount==10&&split[1].amount==16&&split[2].amount==4&&airBefore[1]==air,"air slots usable and 16-stack boundary respected");
  ItemStack sword=new ItemStack(Material.IRON_SWORD,2);ItemStack[] tools=CampOutpost.append(new ItemStack[2],List.of(sword));check(tools[0].amount==1&&tools[1].amount==1,"non-stackable reward split");
  check(thrown(()->CampOutpost.append(new ItemStack[]{old},List.of(new ItemStack(Material.EMERALD,1)))).equals("camp_reward_chest_full"),"occupied partial stack is not reused when full");
  check(old.amount==10&&old.meta.get("owner").equals("original-player"),"full-box failure preserves old slot");
  ItemStack[] tight={old,null};check(thrown(()->CampOutpost.append(tight,List.of(reward))).equals("camp_reward_chest_full"),"partial capacity fails entire batch");
  check(tight[0]==old&&tight[1]==null&&reward.amount==130,"failed partially planned batch leaves inputs unchanged");
  check(thrown(()->CampOutpost.append(new ItemStack[0],List.of(new ItemStack(Material.BREAD,1)))).equals("camp_reward_chest_full"),"zero capacity fails closed");
  ItemStack[] batches=CampOutpost.append(new ItemStack[]{old,null,null},List.of(new ItemStack(Material.ARROW,2),new ItemStack(Material.BREAD,3)));
  check(batches[0].amount==10&&batches[1].type==Material.ARROW&&batches[2].type==Material.BREAD,"multiple rewards consume only empty slots in order");
 }
 static void pendingChoices(){
  Map<String,Object> choice=Map.of("requiresChoice",true,"changed",false);
  check(pendingDifficultyChoice("start","choose_difficulty",choice),"difficulty selection remains pending without generic prerequisite failure");
  check(!pendingDifficultyChoice("join","choose_difficulty",choice),"join cannot disguise a failure as a difficulty choice");
  check(!pendingDifficultyChoice("start","save_failed",choice),"storage failure keeps original feedback");
  check(!pendingDifficultyChoice("start","choose_difficulty",Map.of("requiresChoice",true,"changed",true)),"changed result cannot enter pending-choice feedback");
  check(!pendingDifficultyChoice("start","choose_difficulty",Map.of()),"missing choice evidence stays a normal failure");
 }
 public static void main(String[] args){overlays();localIds();victoriesAndButtons();visits();checkpoints();hudAndSettlement();appendItems();pendingChoices();System.out.println("PASS "+checks+" outdoor/crypt/append real-method checks (synthetic boundaries; not in-game)");}
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-root', type=Path, help='AgentFriend source root for regression comparisons')
    args = parser.parse_args()
    root = args.source_root or Path(__file__).resolve().parents[1]
    inputs = {name: (root / f'src/org/afuhome/agentfriend/{name}.java').read_bytes()
              for name in ('SiteDungeonManager', 'CampOutpost', 'EncounterDesign', 'SiteRewardPolicy')}
    source = inputs['SiteDungeonManager'].decode('utf8')
    outpost = inputs['CampOutpost'].decode('utf8')
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / 'source-hashes.json').write_text(json.dumps({
        str((root / f'src/org/afuhome/agentfriend/{name}.java').resolve()): hashlib.sha256(data).hexdigest()
        for name, data in inputs.items()}, indent=2), encoding='utf8')
    audit(source, outpost)
    signatures = [
        'private static boolean wildCamp(Site site)', 'private static Site campArena(Site site)',
        'private static boolean cryptSite(Site site)', 'private static boolean sameArena(Site site)',
        'private static boolean pendingDifficultyChoice(String action,String reason,Map<String,?> detail)',
        'private static Site encounterArena(Site site)', 'private String[] localCampCommand(Player p,String[] raw)',
        'private boolean campVictory(Site camp)', 'private boolean bossLocked(Run r)',
        'private boolean playing(Player p)', 'private boolean roomVisitor(Player p)',
        'private String musterAdmission(Site site,Player member)', 'private void campInteraction(Player p,Site camp)',
        'private void tickOutdoorCamp()', 'private void tickCryptWaves()', 'private Site surveyedCamp()',
        'public void approachButton(PlayerInteractEvent event)', 'private void updateCampBattle(Run run)', 'private List<DungeonWaveCatalog.Enemy> waveEnemies(Run r)',
        'private void persist(Runnable extra)', 'private void restore()',
        'private boolean rewardEligible(Run r, UUID id)', 'private void completeCamp(Run r)', 'private String siteRewardSlot(Run r,UUID id,String day)',
    ]
    records = [method(source, signature) for signature in [
        'private record Room(', 'private record Site(', 'private enum Mode {', 'private static final class Run {']]
    generated = TEMPLATE.replace('__RECORDS__', '\n'.join(records)).replace(
        '__METHODS__', '\n'.join(method(source, signature) for signature in signatures)).replace(
        '__APPEND__', method(outpost, 'static ItemStack[] append(ItemStack[] before,List<ItemStack> items)')).replace(
        '__DESIGN_METHODS__', '\n'.join(method(inputs['EncounterDesign'].decode('utf8'), s) for s in [
            'static List<DungeonWaveCatalog.Enemy> enemies(', 'static List<DungeonWaveCatalog.Enemy> pressure('])).replace(
        '__REWARD_STATUS__', method(inputs['SiteRewardPolicy'].decode('utf8'), 'static String status('))
    java = args.output / 'SiteDungeonManager.java'
    java.write_text(generated, encoding='utf8')
    suffix = '.exe' if os.name == 'nt' else ''
    subprocess.run([str(args.jdk / 'bin' / ('javac' + suffix)), '-J-Dfile.encoding=UTF-8', '--release', '21', '-encoding', 'UTF-8',
                    '-d', str(args.output), str(java)], check=True)
    subprocess.run([str(args.jdk / 'bin' / ('java' + suffix)), '-Dfile.encoding=UTF-8',
                    '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Duser.language=en', '-Duser.country=US',
                    '-cp', str(args.output), 'SiteDungeonManager'], check=True)


if __name__ == '__main__':
    main()
