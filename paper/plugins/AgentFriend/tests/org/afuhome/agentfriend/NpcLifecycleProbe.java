package org.afuhome.agentfriend;

import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Villager;
import org.bukkit.plugin.java.JavaPlugin;

/** Isolated QA only: fixed test entities, never ship in the production JAR. */
public final class NpcLifecycleProbe extends JavaPlugin {
    private NpcEntityReadiness gate;
    private final Map<String,Object> result=new LinkedHashMap<>();
    private World world;
    @Override public void onEnable(){
        if(!new java.io.File(".qa-only").isFile())throw new IllegalStateException("QA server marker required");
        gate=new NpcEntityReadiness(this);world=Bukkit.getWorlds().getFirst();
        readinessChecks();
        result.put("run",getConfig().getInt("run",0)+1);
        inspect("eager",4096,false);inspect("guarded",4112,true);
        Chunk ephemeral=world.getChunkAt(258,0);
        ephemeral.addPluginChunkTicket(this);
        for(int x:List.of(261,262))world.getChunkAt(x,0).addPluginChunkTicket(this);
        getServer().getScheduler().runTaskLater(this,()->{
            if(!getConfig().contains("ephemeral")){
                Villager v=spawn("ephemeral",4128);v.setPersistent(false);
                getConfig().set("ephemeral",v.getUniqueId().toString());
            }else result.put("ephemeralRestored",Bukkit.getEntity(UUID.fromString(getConfig().getString("ephemeral")))!=null);
            for(String role:List.of("eager","guarded")){
                int x=role.equals("eager")?4096:4112;
                result.put(role+"Count",Arrays.stream(world.getChunkAt(x>>4,0).getEntities()).filter(e->e instanceof Villager).count());
                result.put(role+"Uuid",getConfig().getString(role));
            }
            var speak=Bukkit.getPluginManager().getPlugin("NPCSpeak");
            if(speak!=null)try{
                Object manager=speak.getClass().getMethod("getNpcManager").invoke(speak);
                var rows=new ArrayList<Map<String,Object>>();
                for(Object npc:(Collection<?>)manager.getClass().getMethod("getAll").invoke(manager)){
                    UUID id=(UUID)npc.getClass().getMethod("getEntityUUID").invoke(npc);
                    var entity=id==null?null:Bukkit.getEntity(id);
                    Map<String,Object> row=new LinkedHashMap<>();row.put("id",npc.getClass().getMethod("getId").invoke(npc));row.put("uuid",String.valueOf(id));row.put("present",entity!=null);row.put("silent",entity!=null&&entity.isSilent());row.put("lookupSame",manager.getClass().getMethod("getByEntityUUID",UUID.class).invoke(manager,id)==npc);rows.add(row);
                }
                result.put("npcSpeak",rows);
            }catch(Exception failure){throw new RuntimeException(failure);}
            getConfig().set("run",result.get("run"));saveConfig();
            try{java.nio.file.Files.writeString(getDataFolder().toPath().resolve("result-"+result.get("run")+".json"),new com.google.gson.GsonBuilder().setPrettyPrinting().create().toJson(result));}
            catch(Exception e){throw new RuntimeException(e);}
            getLogger().info("NPC_LIFECYCLE_QA "+result);
        },240L);
    }
    private void inspect(String role,int x,boolean guarded){
        Location at=new Location(world,x+0.5,66,0.5);Chunk chunk=world.getChunkAt(at);
        chunk.addPluginChunkTicket(this);
        result.put(role+"InitiallyEntitiesLoaded",chunk.isEntitiesLoaded());
        String prior=getConfig().getString(role);
        result.put(role+"PriorUuid",prior==null?"none":prior);
        result.put(role+"ImmediateUuidVisible",prior!=null&&Bukkit.getEntity(UUID.fromString(prior))!=null);
        Runnable ensure=()->{
            String id=getConfig().getString(role);
            if(id!=null&&Bukkit.getEntity(UUID.fromString(id)) instanceof Villager){result.put(role+"Reused",true);return;}
            getConfig().set(role,spawn(role,x).getUniqueId().toString());result.put(role+"Reused",false);
        };
        if(!guarded||gate.ready(role,at,ensure))ensure.run();
    }
    private Villager spawn(String role,int x){return world.spawn(new Location(world,x+0.5,66,0.5),Villager.class,v->{v.setAI(false);v.setGravity(false);v.setInvulnerable(true);v.setCustomName(role);v.setSilent(true);v.setPersistent(true);});}
    private void readinessChecks(){
        NpcEntityReadiness test=new NpcEntityReadiness(this);
        FakeChunk shared=new FakeChunk(true),existing=new FakeChunk(false),timeout=new FakeChunk(true),closing=new FakeChunk(true);
        int[] callbacks={0};
        result.put("pendingReturnsFalse",!test.ready("one",shared.at(),()->callbacks[0]++));
        test.ready("one",shared.at(),()->callbacks[0]+=100);test.ready("two",shared.at(),()->callbacks[0]++);
        result.put("duplicateRequestCoalesced",shared.adds==1);test.cancel("one");
        result.put("cancelPreservesSharedLease",shared.removes==0);shared.loaded=true;
        test.ready("existing",existing.at(),()->{});existing.loaded=true;
        test.ready("timeout",timeout.at(),()->callbacks[0]+=1000);
        NpcEntityReadiness closed=new NpcEntityReadiness(this);closed.ready("closing",closing.at(),()->callbacks[0]+=10000);closed.close();
        result.put("closeReleasesOwnedTicket",closing.removes==1);
        getServer().getScheduler().runTaskLater(this,()->{
            result.put("readyCallbackExactlyOnce",callbacks[0]==1);result.put("ownedTicketReleased",shared.removes==1);result.put("existingTicketRetained",existing.removes==0);
            result.put("timeoutNoSpawn",callbacks[0]==1&&timeout.removes==1);test.close();
        },220L);
    }
    private static final class FakeChunk {
        boolean loaded;int adds,removes;final boolean owned;World world;final Chunk chunk;
        FakeChunk(boolean owned){
            this.owned=owned;UUID id=UUID.randomUUID();
            chunk=(Chunk)java.lang.reflect.Proxy.newProxyInstance(Chunk.class.getClassLoader(),new Class<?>[]{Chunk.class},(p,m,a)->switch(m.getName()){
                case "isEntitiesLoaded"->loaded;case "getWorld"->this.world;case "getX","getZ"->0;case "addPluginChunkTicket"->{adds++;yield owned;}case "removePluginChunkTicket"->{removes++;yield true;}default->throw new UnsupportedOperationException(m.getName());});
            world=(World)java.lang.reflect.Proxy.newProxyInstance(World.class.getClassLoader(),new Class<?>[]{World.class},(p,m,a)->switch(m.getName()){
                case "getUID"->id;case "getChunkAt"->chunk;default->throw new UnsupportedOperationException(m.getName());});
        }
        Location at(){return new Location(world,0,0,0);}
    }
    @Override public void onDisable(){if(gate!=null)gate.close();saveConfig();}
}
