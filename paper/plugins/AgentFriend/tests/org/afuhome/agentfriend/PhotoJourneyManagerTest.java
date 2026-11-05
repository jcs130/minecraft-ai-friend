package org.afuhome.agentfriend;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.logging.Logger;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Runs the complete production manager class against explicit Bukkit/ImageFrame doubles.
 * No Minecraft, model, image rendering, upload server, real album or inventory is involved. */
public final class PhotoJourneyManagerTest {
    static int checks;
    static final UUID OWNER=UUID.randomUUID(),WORLD=UUID.randomUUID(),JOB=UUID.randomUUID();
    static final String NONCE=UUID.randomUUID().toString();
    static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);checks++;}
    static void set(Object o,String name,Object value)throws Exception{Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);f.set(o,value);}
    static void optionalReceiptField(Object o,Object value)throws Exception{try{set(o,"receipts",value);}catch(NoSuchFieldException baseline){/* Original PR has no durable receipt field. */}}
    static Object get(Object o,String name)throws Exception{Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(o);}
    static Object empty(Class<?> c)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),c);}
    public static final class Images {public static ImageManager imageMapManager=new ImageManager();public static String mapItemFormat="test";public static Map<Object,Object> pendingUploads=new HashMap<>();}
    public static final class ImageManager {Original original;public Object getFromCreator(UUID owner,String name){return owner.equals(OWNER)&&name.equals("旅途")?original:null;}}
    public static final class Original {
        public UUID getCreator(){return OWNER;} public int getImageIndex(){return 17;}
        public boolean isValid(){return true;} public List<Integer> getMapIds(){return List.of(23);}
        public List<ItemStack> getMaps(String format){return List.of(mock(ItemStack.class));}
    }
    public static final class Upload {public java.util.concurrent.Future<java.io.File> getFile(){return java.util.concurrent.CompletableFuture.completedFuture(new java.io.File("test-double-only.png"));}}
    static final class Fixture {
        final AgentFriendPlugin plugin=mock(AgentFriendPlugin.class);
        final Player owner=mock(Player.class),camera=mock(Player.class);
        final PhotoJournal journal=mock(PhotoJournal.class);
        final DungeonManager dungeon=mock(DungeonManager.class);
        final Path file;
        PhotoTaskLedger ledger;
        final PhotoCameraManager manager;
        final Object job;
        final List<JsonObject> receipts=new ArrayList<>();
        Fixture(Server server)throws Exception {
            file=Files.createTempDirectory("photo-manager-").resolve("photo-tasks.json");ledger=new PhotoTaskLedger(file);
            when(owner.getUniqueId()).thenReturn(OWNER);when(owner.getName()).thenReturn("PhotoJourneyQA");when(owner.isOnline()).thenReturn(true);
            when(plugin.getLogger()).thenReturn(Logger.getLogger("photo-fixture"));when(plugin.goddessLandAdministrator()).thenReturn(camera);when(plugin.isRegisteredAgent(owner)).thenReturn(true);when(plugin.dungeon()).thenReturn(dungeon);
            when(dungeon.storePhoto(eq(OWNER),eq(17),anyList())).thenReturn(true);
            when(server.getPlayer(OWNER)).thenReturn(owner);World world=mock(World.class);when(world.getUID()).thenReturn(WORLD);when(owner.getWorld()).thenReturn(world);when(server.getWorld(WORLD)).thenReturn(world);
            when(camera.getSpectatorTarget()).thenReturn(null);
            doAnswer(invocation->{byte[] bytes=invocation.getArgument(2);receipts.add(JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject());return null;}).when(owner).sendPluginMessage(eq(plugin),eq(PhotoCameraManager.CHANNEL),any(byte[].class));
            manager=(PhotoCameraManager)empty(PhotoCameraManager.class);
            set(manager,"plugin",plugin);set(manager,"queue",new ArrayDeque<>());set(manager,"last",new HashMap<UUID,Long>());optionalReceiptField(manager,ledger);set(manager,"journal",journal);set(manager,"messages",mock(PhotoCameraMessages.class));set(manager,"enabled",true);set(manager,"heartbeat",System.currentTimeMillis());set(manager,"queueLimit",1);set(manager,"cooldown",60);set(manager,"phase","idle");set(manager,"imageFrame",Images.class);set(manager,"pendingUploads",Images.class.getField("pendingUploads"));
            Class<?> type=Class.forName(PhotoCameraManager.class.getName()+"$Job");Constructor<?> ctor=type.getDeclaredConstructors()[0];
            ctor=type.getDeclaredConstructor(UUID.class,String.class,UUID.class,String.class,String.class,int.class,UUID.class,long.class,String.class);ctor.setAccessible(true);
            job=ctor.newInstance(JOB,NONCE,OWNER,"旅途","third",1,WORLD,System.currentTimeMillis(),"洞口见闻");Images.imageMapManager.original=null;
        }
        void start()throws Exception {
            check(ledger.begin(OWNER,JOB,new PhotoRequest("旅途","third",1,"洞口见闻"),System.currentTimeMillis()),"fixture admitted");
            JsonObject shot=new JsonObject();shot.addProperty("world",WORLD.toString());shot.addProperty("x",1);shot.addProperty("y",64);shot.addProperty("z",2);shot.addProperty("time",System.currentTimeMillis());
            JsonObject fields=new JsonObject();fields.add("capture",shot);fields.addProperty("startedAt",System.currentTimeMillis());ledger.update(OWNER,JOB,"rendering",fields);
            set(manager,"active",job);set(manager,"phase","rendering");
        }
        void send(String type,UUID id)throws Exception{JsonObject j=new JsonObject();j.addProperty("type",type);j.addProperty("job",id.toString());j.addProperty("nonce",NONCE);manager.onPluginMessageReceived(PhotoCameraManager.CHANNEL,camera,j.toString().getBytes(StandardCharsets.UTF_8));}
        void restart()throws Exception{ledger=new PhotoTaskLedger(file);set(manager,"receipts",ledger);set(manager,"active",null);set(manager,"phase","idle");}
    }
    public static void main(String[] args)throws Exception {
        Server server=mock(Server.class);when(server.getLogger()).thenReturn(Logger.getLogger("bukkit-fixture"));
        // Set the test double directly: Bukkit.setServer also loads real server build
        // metadata, which would incorrectly require a booted Minecraft runtime here.
        Field singleton=Bukkit.class.getDeclaredField("server");singleton.setAccessible(true);singleton.set(null,server);
        Fixture f=new Fixture(server);
        if(args.length>0&&args[0].equals("--upload-ack-only")){
            f.start();f.send("uploading",JOB);f.send("failed",JOB);
            check(get(f.manager,"active")!=null,"HTTP/ACK failure after upload must retain original import");
            System.out.println("upload-ack-regression passed=true scope=game-api-doubles");return;
        }
        check(f.manager.readyForReminder(f.owner,System.currentTimeMillis()),"ready camera permits suggestion");
        @SuppressWarnings("unchecked") ArrayDeque<Object> queue=(ArrayDeque<Object>)get(f.manager,"queue");queue.add(f.job);
        Player other=mock(Player.class);when(other.getUniqueId()).thenReturn(UUID.randomUUID());
        check(!f.manager.readyForReminder(other,System.currentTimeMillis()),"full queue suppresses another owner's suggestion");queue.clear();
        set(f.manager,"heartbeat",0L);check(!f.manager.readyForReminder(f.owner,System.currentTimeMillis()),"stale camera suppresses suggestion");set(f.manager,"heartbeat",System.currentTimeMillis());
        f.start();check(!f.manager.readyForReminder(f.owner,System.currentTimeMillis()),"existing request suppresses suggestion");
        f.send("failed",UUID.randomUUID());check(get(f.manager,"active")!=null,"foreign job receipt ignored");
        f.send("failed",JOB);check(get(f.manager,"active")==null,"known render failure stops before upload");
        check(f.ledger.latest(OWNER).get("status").getAsString().equals("stopped"),"known failure retained");
        check(!f.manager.readyForReminder(f.owner,System.currentTimeMillis()),"cooldown suppresses suggestion");
        f=new Fixture(server);f.start();f.send("uploading",JOB);f.send("failed",JOB);
        check(get(f.manager,"active")!=null,"HTTP/ACK failure after upload retains original import");
        check(get(f.manager,"phase").equals("confirming"),"uncertain upload goes to reconciliation");
        f.manager.onQuit(new PlayerQuitEvent(f.owner,"fixture quit"));check(get(f.manager,"active")!=null,"disconnect does not discard in-flight upload");
        f.send("uploaded",JOB);f.send("uploaded",JOB);check(f.ledger.latest(OWNER).get("job").getAsString().equals(JOB.toString()),"duplicate ACK preserves one task");
        f.restart();f.manager.command(f.owner,new String[]{"photo","status"});
        JsonObject pending=f.receipts.getLast();check(pending.get("status").getAsString().equals("unknown"),"restart without original reports unknown");
        check(pending.get("job").getAsString().equals(JOB.toString()),"query retains original correlation");
        f.manager.command(f.owner,new String[]{"photo","take","重拍","third","1","--story","同一见闻"});
        check(f.receipts.getLast().get("status").getAsString().equals("denied"),"uncertain task cannot be bypassed by new name");
        verify(f.plugin,never()).spendMana(any(),anyDouble());
        Images.imageMapManager.original=new Original();f.manager.command(f.owner,new String[]{"photo","status"});
        verify(f.dungeon,never()).storePhoto(any(),anyInt(),anyList());
        check(f.receipts.getLast().get("status").getAsString().equals("unknown"),"status remains read-only even when original appears");
        // Invoke the exact recovery method used by join/ImageFrame-load callbacks.
        Method recover=PhotoCameraManager.class.getDeclaredMethod("recoverReceipt",Player.class);recover.setAccessible(true);recover.invoke(f.manager,f.owner);
        f.manager.command(f.owner,new String[]{"photo","status"});
        JsonObject done=f.receipts.getLast();check(done.get("status").getAsString().equals("success"),"existing original can reconcile after restart");
        check(done.get("owner").getAsString().equals(OWNER.toString())&&done.get("name").getAsString().equals("旅途")&&done.get("imageIndex").getAsInt()==17&&done.getAsJsonArray("mapIds").get(0).getAsInt()==23,"receipt binds owner job and original maps");
        check(!done.get("journalRecorded").getAsBoolean(),"failed/mocked journal is not misrepresented as complete");
        verify(f.journal).delivered(eq(f.owner),eq(JOB),eq("旅途"),eq("third"),anyLong(),any(),any(),any(),any(),any(),eq("洞口见闻"));
        f.send("failed",JOB);check(f.ledger.latest(OWNER).get("status").getAsString().equals("success"),"late failure cannot overwrite recovered success");
        check(!done.has("nonce")&&!done.has("uploadId"),"private upload credentials omitted from receipt");
        f=new Fixture(server);f.start();set(f.manager,"nativeUpload",new Upload());f.send("failed",JOB);
        check(get(f.manager,"active")!=null&&get(f.manager,"phase").equals("confirming"),"native completed upload is reconciled even if both worker ACKs are missing");
        f.manager.command(f.owner,new String[]{"photo","cancel"});check(get(f.manager,"active")!=null,"completed upload cannot be cancelled as though it never happened");
        f=new Fixture(server);f.start();f.manager.command(f.owner,new String[]{"photo","cancel"});
        check(f.ledger.latest(OWNER).get("status").getAsString().equals("stopped"),"explicit cancellation before upload preserves the existing ability to try later");
        System.out.println("photo-journey-manager-checks="+checks+" passed=true scope=game-api-doubles");
    }
}
