package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import org.bukkit.*;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.block.*;
import org.bukkit.block.data.*;
import org.bukkit.block.data.type.Bed;
import org.bukkit.block.data.type.Door;
import org.bukkit.entity.Player;
import org.bukkit.event.player.*;
import org.bukkit.inventory.Inventory;
import org.bukkit.util.BoundingBox;

/** Template only: runner injects current production methods, never a second exam model. */
public final class ExamMethodBodyFixture {
    static final class Bukkit {
        static final Map<UUID,Player> players=new HashMap<>();
        static Player getPlayer(UUID id){return players.get(id);}
    }
    static final class Task {boolean cancelled;void cancel(){cancelled=true;}}
    static record Menu(UUID owner) { }
    static final class Ledger {
        final ProfessionLedger real;
        final Path file;
        int attempts,commits;
        boolean fail;
        Runnable beforeEdit;
        final List<JsonObject> candidates=new ArrayList<>();
        Ledger(Path file){this.file=file;real=new ProfessionLedger(file);}
        boolean ready(){return real.ready();}
        JsonObject data(){return real.data();}
        JsonObject profile(UUID id){return real.profile(id);}
        boolean write(Consumer<JsonObject> edit){
            attempts++;
            if(beforeEdit!=null){Runnable hook=beforeEdit;beforeEdit=null;hook.run();}
            boolean ok=real.write(root->{edit.accept(root);candidates.add(root.deepCopy());if(fail)throw new IllegalStateException("injected post-edit storage failure");});
            if(ok)commits++;
            return ok;
        }
    }
    static final class Exam {
        static final String CHANNEL="mcagent:exam";
        final AgentFriendPlugin plugin;
        final Ledger ledger;
        final ExamSupplies supplies=new ExamSupplies();
        AssessmentCatalog catalog;
        boolean validLedger=true;
        final Map<UUID,Run> runs=new HashMap<>();
        final Map<Inventory,Menu> menus=new IdentityHashMap<>();
        final Task task=new Task();
        Map<UUID,JsonObject> sampleWrites;
        Map<UUID,Run> sampleCandidates;
        List<Runnable> sampleNotices;
        static final String[] RANKS={"青铜","黑铁","白银","黄金","白金","钻石"};
        static final String[] DIVISIONS={"III","II","I"};
        Exam(AgentFriendPlugin plugin,Ledger ledger,AssessmentCatalog catalog){this.plugin=plugin;this.ledger=ledger;this.catalog=catalog;}
        // Unselected branches fail rather than pretending to exercise their production code.
        void supplyReply(Player p,JsonObject result,boolean compact){throw new AssertionError("unexpected photo delivery branch");}
        void suppliesCommand(Player p,String[] args,boolean machine){throw new AssertionError("supplies branch not covered");}
        /*__REAL_METHOD_BODIES__*/
    }
    static Object invoke(Object target,String name,Object... args){
        for(Method m:target.getClass().getDeclaredMethods())if(m.getName().equals(name)&&m.getParameterCount()==args.length){
            boolean match=true;
            for(int i=0;i<args.length;i++)if(args[i]!=null&&!boxed(m.getParameterTypes()[i]).isInstance(args[i]))match=false;
            if(!match)continue;
            try{m.setAccessible(true);return m.invoke(target,args);}catch(InvocationTargetException e){
                if(e.getCause() instanceof RuntimeException r)throw r;
                if(e.getCause() instanceof Error r)throw r;
                throw new RuntimeException(e.getCause());
            }catch(ReflectiveOperationException e){throw new RuntimeException(e);}
        }
        throw new IllegalArgumentException("method missing: "+name+"/"+args.length);
    }
    private static Class<?> boxed(Class<?> c){return c==int.class?Integer.class:c==long.class?Long.class:c==boolean.class?Boolean.class:c;}
    static Object field(Object target,String name){try{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(target);}catch(Exception e){throw new RuntimeException(e);}}
    static void field(Object target,String name,Object value){try{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);f.set(target,value);}catch(Exception e){throw new RuntimeException(e);}}
    static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    static final class Env {
        final FakeWorld world=new FakeWorld();
        final FakePlayer actor=new FakePlayer(world);
        final Player p=actor.player;
        final AgentFriendPlugin plugin=new AgentFriendPlugin();
        final Ledger ledger;
        final Exam exam;
        Env(AssessmentCatalog catalog,Path directory,String label){
            ledger=new Ledger(directory.resolve(label+"-academy.json"));exam=new Exam(plugin,ledger,catalog);
            Bukkit.players.put(actor.id,p);
        }
        Object call(String name,Object... args){return invoke(exam,name,args);}
        Object run(){return exam.runs.get(actor.id);}
        Object observed(){return call("observed",p);}
        JsonObject record(){return (JsonObject)call("record",observed());}
        JsonObject summary(){return (JsonObject)call("summary",p);}
        JsonObject academy(){return (JsonObject)call("academy",actor.id);}
        JsonObject active(){return academy().getAsJsonObject("active");}
        void start(String id){call("start",p,id,false);}
        boolean submit(){return (boolean)call("submit",p,observed());}
        void seedGrade(int grade,Collection<String> certs){ledger.write(root->{JsonObject a=new JsonObject();a.addProperty("grade",grade);JsonObject c=new JsonObject();for(String id:certs)c.addProperty(id,"retained");a.add("certificates",c);ProfessionLedger.profile(root,actor.id).add("academy",a);});}
        void house(long timestamp,UUID owner){
            world.home();List<String> rows=new ArrayList<>();
            world.cells.forEach((pos,cell)->rows.add(new HouseEvidence.Placement(world.id+":"+pos.x()+":"+pos.y()+":"+pos.z(),cell.material.name(),owner,timestamp).encode()));
            plugin.config.set("house-evidence."+actor.id+".placements",rows);
            actor.at=new Location(world.world,2,1,2);
        }
        void houseForRun(){house(active().get("startedAt").getAsLong(),actor.id);}
        void replaceRun(JsonObject record){Exam.Run run=(Exam.Run)call("decode",record);exam.runs.put(actor.id,run);check((boolean)call("save",p,run),"seed run durable");}
        void clearMemory(){exam.runs.clear();}
    }
    static final class Cell {
        final Material material;
        final BlockData data;
        Cell(Material m,BlockData d){material=m;data=d;}
    }
    static final class FakeWorld implements InvocationHandler {
        final UUID id=UUID.randomUUID();
        final Map<StarterHouseValidator.Pos,Cell> cells=new LinkedHashMap<>();
        boolean loaded=true;
        final World world=proxy(World.class,this);
        void set(int x,int y,int z,Material m){cells.put(new StarterHouseValidator.Pos(x,y,z),new Cell(m,proxy(BlockData.class,(p,f,a)->defaults(f.getReturnType()))));}
        void bed(int x,int y,int z,Bed.Part part){cells.put(new StarterHouseValidator.Pos(x,y,z),new Cell(Material.RED_BED,proxy(Bed.class,(p,m,a)->switch(m.getName()){case "getPart"->part;case "getFacing"->BlockFace.SOUTH;default->defaults(m.getReturnType());})));}
        void door(int x,int y,int z,Bisected.Half half){cells.put(new StarterHouseValidator.Pos(x,y,z),new Cell(Material.OAK_DOOR,proxy(Door.class,(p,m,a)->switch(m.getName()){case "getHalf"->half;case "getFacing"->BlockFace.NORTH;default->defaults(m.getReturnType());})));}
        void home(){
            cells.clear();loaded=true;
            for(int x=0;x<5;x++)for(int z=0;z<5;z++){
                set(x,0,z,Material.OAK_PLANKS);set(x,3,z,Material.OAK_PLANKS);
                if(x==0||x==4||z==0||z==4){set(x,1,z,Material.OAK_PLANKS);set(x,2,z,Material.OAK_PLANKS);}
            }
            bed(1,1,1,Bed.Part.FOOT);bed(1,1,2,Bed.Part.HEAD);
            door(2,1,0,Bisected.Half.BOTTOM);door(2,2,0,Bisected.Half.TOP);
            set(0,2,2,Material.GLASS_PANE);set(2,0,-1,Material.OAK_PLANKS);
        }
        Block block(int x,int y,int z){
            Cell cell=cells.getOrDefault(new StarterHouseValidator.Pos(x,y,z),new Cell(Material.AIR,proxy(BlockData.class,(p,m,a)->defaults(m.getReturnType()))));
            return proxy(Block.class,(p,m,a)->switch(m.getName()){
                case "getWorld"->world;case "getX"->x;case "getY"->y;case "getZ"->z;
                case "getType"->cell.material;case "getBlockData"->cell.data;
                case "isLiquid"->false;case "isPassable"->cell.material==Material.AIR;
                case "getBoundingBox"->new BoundingBox(x,y,z,x+1,y+1,z+1);
                case "getRelative"->{if(a[0] instanceof BlockFace f){int n=a.length>1?(int)a[1]:1;yield block(x+f.getModX()*n,y+f.getModY()*n,z+f.getModZ()*n);}yield block(x+(int)a[0],y+(int)a[1],z+(int)a[2]);}
                default->defaults(m.getReturnType());
            });
        }
        public Object invoke(Object proxy,Method m,Object[] args){return switch(m.getName()){
            case "getUID"->id;case "getMinHeight"->-64;case "getMaxHeight"->320;case "isChunkLoaded"->loaded;
            case "getBlockAt"->{if(args.length==1){Location l=(Location)args[0];yield block(l.getBlockX(),l.getBlockY(),l.getBlockZ());}yield block((int)args[0],(int)args[1],(int)args[2]);}
            case "getName"->"synthetic_exam_world";case "equals"->proxy==args[0];case "hashCode"->System.identityHashCode(proxy);
            default->defaults(m.getReturnType());
        };}
    }
    static final class FakePlayer implements InvocationHandler {
        final UUID id=UUID.randomUUID();
        final FakeWorld world;
        final Player player=proxy(Player.class,this);
        final List<String> messages=new ArrayList<>();
        final List<JsonObject> outputs=new ArrayList<>();
        Location at;
        boolean ground=true,flying;
        FakePlayer(FakeWorld world){this.world=world;at=new Location(world.world,0,64,0);world.set(0,63,0,Material.STONE);}
        JsonObject last(){return outputs.getLast();}
        public Object invoke(Object proxy,Method m,Object[] args){return switch(m.getName()){
            case "getUniqueId"->id;case "getWorld"->world.world;case "getLocation"->at.clone();case "getGameMode"->GameMode.SURVIVAL;
            case "isOnGround"->ground;case "isFlying"->flying;case "isOnline"->true;
            case "getName"->"synthetic_exam_actor";case "equals"->proxy==args[0];case "hashCode"->System.identityHashCode(proxy);
            case "sendMessage"->{if(args!=null)for(Object value:args)if(value instanceof String s){messages.add(s);int brace=s.indexOf(" {");if(brace>=0)outputs.add(JsonParser.parseString(s.substring(brace+1)).getAsJsonObject());}yield null;}
            case "sendPluginMessage"->null;
            default->defaults(m.getReturnType());
        };}
    }
    @SuppressWarnings("unchecked") static <T>T proxy(Class<T> type,InvocationHandler h){return (T)Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},h);}
    static Object defaults(Class<?> type){
        if(!type.isPrimitive())return null;
        if(type==boolean.class)return false;if(type==int.class)return 0;if(type==long.class)return 0L;
        if(type==double.class)return 0d;if(type==float.class)return 0f;if(type==byte.class)return (byte)0;
        if(type==short.class)return (short)0;if(type==char.class)return '\0';return null;
    }
}

// Material properties ordinarily query Paper's live block registry. These are
// external facts for ONLY the explicit synthetic-world materials, not inspection logic.
final class ExamMaterialFacts {
    static boolean occluding(Material m){return switch(m){
        case STONE, OAK_PLANKS -> true;
        case AIR, RED_BED, OAK_DOOR, GLASS, GLASS_PANE -> false;
        default -> throw new AssertionError("offline material fact not declared: "+m);
    };}
    static boolean solid(Material m){return switch(m){
        case STONE, OAK_PLANKS, GLASS, GLASS_PANE, RED_BED, OAK_DOOR -> true;
        case AIR -> false;
        default -> throw new AssertionError("offline support fact not declared: "+m);
    };}
}

// External plugin/service boundaries only; no grading/inspection/exam logic here.
final class AgentFriendPlugin {
    final org.bukkit.configuration.file.YamlConfiguration config=new org.bukkit.configuration.file.YamlConfiguration();
    final GuildManager guild=new GuildManager();
    final TaskMarketManager market=new TaskMarketManager();
    final FlightLeases leases=new FlightLeases();
    final Professions professions=new Professions();
    final Training training=new Training();
    boolean observer,downed,pvp,dungeon;
    org.bukkit.configuration.file.YamlConfiguration getConfig(){return config;}
    java.util.logging.Logger getLogger(){return java.util.logging.Logger.getLogger("exam-fixture");}
    GuildManager guild(){return guild;}TaskMarketManager taskMarket(){return market;}
    Communication communication(){return new Communication();}
    FlightLeases flightLeases(){return leases;}Professions professions(){return professions;}
    Training featureTutorials(){return training;}Training traversalPractice(){return training;}
    boolean isObserver(Player p){return observer;}boolean isDowned(Player p){return downed;}
    boolean pvpParticipant(Player p){return pvp;}boolean dungeonParticipant(Player p){return dungeon;}
}
final class DurableConfigStore {
    static Map<String,Object> audit(AgentFriendPlugin p){return Map.of("commitUnknown",false);}
    static void persist(AgentFriendPlugin p)throws IOException{throw new AssertionError("config persist is outside exam-only fixture");}
}
final class Communication {
    boolean compact(Player p){return true;}
    void taskTransition(Player p,String track,String run,String phase,String command){}
}
final class Professions {int level(Player p,String id){return 1;}}
final class Training {
    int enrollments,starts;void enroll(Player p){enrollments++;}void command(Player p,String action){starts++;}
    boolean verified(Player p,String proof){return false;}
}
final class ExamSupplies {
    int allocations;
    void automaticPhoto(Player p,AssessmentCatalog.Definition d,UUID id,Consumer<JsonObject> done){/* no photo requested */}
    JsonObject all(Player p,AssessmentCatalog.Definition d){return new JsonObject();}
}
final class GuildManager {
    enum Goal {SKILL_ASSESSMENT}
    boolean joined=true,contract,lifeContract,history=true;int fame=1000,legacy,mirrors;
    boolean hasJoined(Player p){return joined;}boolean hasActiveContract(Player p){return contract||lifeContract;}
    boolean hasAdventureContract(Player p){return contract;}
    int readLegacyRank(Player p){return legacy;}int reputation(Player p){return fame;}
    boolean promotionHistoryMet(int rank,Player p){return history;}
    String promotionHistoryAdvice(int rank){return "synthetic history";}
    JsonArray missingPromotionHistory(Player p,int rank){return new JsonArray();}
    void mirrorPromotion(Player p,int rank){mirrors++;}
    String activeId(Player p){return "synthetic_contract";}
}
final class TaskMarketManager {
    AssessmentCatalog.Definition active;String token="";int settlements;
    AssessmentCatalog.Definition activeAssessment(Player p){return active;}String stepToken(Player p){return token;}
    void worldAction(Player p,GuildManager.Goal goal,String id,String run,long at){settlements++;}
    JsonObject progressState(Player p){return new JsonObject();}JsonObject examRequirements(Player p){return null;}
    JsonObject photoStatus(Player p){return new JsonObject();}
    JsonObject assessmentContracts(Player p,List<String> proofs){JsonObject o=new JsonObject();o.add("items",new JsonArray());return o;}
    List<Offer> offers(){return List.of();}String offerState(Offer task,Player p){return "unavailable";}
    static void showGuidance(Player p,JsonObject current){throw new AssertionError("survey UI not covered");}
    record Contract(int fame){}record Offer(String id,String title){Contract contract(int step){return new Contract(1);}}
}
final class FlightLeases {
    record Lease(UUID token,String skill,long started,int level){}
    Lease lease;Lease active(Player p){return lease;}
}
final class GuildAdventureGuide {record Hint(String message,String command){}}
final class GuildRankPoints {static final int LAST_GRADE=17;}
