package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import local.qdj.maids.brain.MaidAgentsMod;
import local.qdj.maids.brain.ResidentBodyAccess;
import local.tlmcompat.core.CompatibilityException;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** A self-service owner index. One reservation always names one original native entity. */
final class GuideCompanions implements Listener {
    private static final String MARKER = "qiandengji_player_guide";
    private static final String PARKED = "qiandengji_companion_offline";
    private static final String DEFAULT_SUFFIX = "的伙伴";
    private record Guide(UUID owner, UUID body, String name, boolean confirmed, long revision) {
        Guide confirm() { return new Guide(owner, body, name, true, revision); }
        JsonObject json() {
            var row = new JsonObject();
            row.addProperty("ownerId", owner.toString());
            row.addProperty("maidId", body.toString());
            row.addProperty("name", name);
            row.addProperty("confirmed", confirmed);
            row.addProperty("profileRevision", revision);
            return row;
        }
    }

    private final HybridMaidPlugin plugin;
    private final Path file;
    private final Map<UUID,Guide> owners = new LinkedHashMap<>();
    private final Map<UUID,Guide> bodies = new LinkedHashMap<>();
    private boolean available;

    GuideCompanions(HybridMaidPlugin plugin) {
        this.plugin=plugin;
        file=plugin.getDataFolder().toPath().resolve("guide-companions.json");
        try {
            if (Files.exists(file)) {
                if (Files.size(file)>4*1024*1024) throw new IllegalStateException("guide_registry_size");
                var saved=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
                if (saved.get("schema").getAsInt()!=1) throw new IllegalStateException("guide_registry_schema");
                for (var item:saved.getAsJsonArray("guides")) {
                    var row=item.getAsJsonObject();
                    var guide=new Guide(MaidBodyControl.uuid(row,"ownerId"),MaidBodyControl.uuid(row,"maidId"),
                        name(row.get("name").getAsString()),row.get("confirmed").getAsBoolean(),
                        row.has("profileRevision")?row.get("profileRevision").getAsLong():0);
                    if (owners.containsKey(guide.owner)||bodies.containsKey(guide.body)||guide.owner.equals(guide.body))
                        throw new IllegalStateException("guide_registry_identity");
                    remember(guide);
                    plugin.registerUnifiedBody(guide.body);
                }
            }
            available=true;
            Bukkit.getPluginManager().registerEvents(this,plugin);
            Bukkit.getScheduler().runTaskTimer(plugin,this::register,20,100);
        } catch (Exception invalid) {
            plugin.getLogger().warning("Player guides paused; guide-companions.json could not be verified");
        }
    }

    private static String name(String value) {
        String trimmed=value.strip();
        if (trimmed.isEmpty()||trimmed.codePointCount(0,trimmed.length())>24
            ||trimmed.codePoints().anyMatch(c->Character.isISOControl(c)||Character.getType(c)==Character.FORMAT||c==0xA7))
            throw new CompatibilityException("bad_name","名字须为 1 到 24 个普通字符。");
        return trimmed;
    }

    private void remember(Guide guide) {
        owners.put(guide.owner,guide);
        bodies.put(guide.body,guide);
    }

    private void put(Guide guide) throws Exception {
        var saved=new JsonObject();
        var rows=new JsonArray();
        for (var old:owners.values()) if (!old.owner.equals(guide.owner)) rows.add(old.json());
        rows.add(guide.json());
        saved.addProperty("schema",1);
        saved.add("guides",rows);
        var temp=Files.createTempFile(file.getParent(),"guide-index-",".tmp");
        try {
            Files.writeString(temp,saved.toString());
            try(var channel=java.nio.channels.FileChannel.open(temp,java.nio.file.StandardOpenOption.WRITE)){channel.force(true);}
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            remember(guide);
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    boolean ready() { return available&&MaidAgentsMod.guideRegistrationReady(); }
    boolean known(UUID id) { return bodies.containsKey(id); }
    UUID owner(UUID id) {
        var guide=bodies.get(id);
        return available&&guide!=null&&guide.confirmed?guide.owner:null;
    }
    boolean matches(EntityMaid maid) {
        return maid!=null&&maid.getOwnerUUID()!=null&&maid.getOwnerUUID().equals(owner(maid.getUUID()))
            &&maid.getOwnerUUID().toString().equals(maid.getPersistentData().getString(MARKER));
    }
    private EntityMaid loaded(Guide guide) {
        var maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(guide.body));
        return maid!=null&&maid.isAlive()&&guide.owner.equals(maid.getOwnerUUID())
            &&guide.owner.toString().equals(maid.getPersistentData().getString(MARKER))?maid:null;
    }
    private void register() {
        if (!ready()) return;
        for (var actor:Bukkit.getOnlinePlayers()) {
            var guide=owners.get(actor.getUniqueId());
            if (guide!=null&&guide.confirmed) MaidAgentsMod.registerPlayerGuide(guide.body,guide.owner,guide.name);
        }
    }
    void seen(EntityMaid maid) throws Exception {
        var guide=bodies.get(maid.getUUID());
        if (!ready()||guide==null||loaded(guide)!=maid) return;
        MaidAgentsMod.registerPlayerGuide(guide.body,guide.owner,guide.name);
        if (guide.confirmed) {
            if(Bukkit.getPlayer(guide.owner)==null)park(maid); else resume(maid);
            return;
        }
        ResidentBodyAccess.save(guide.body);
        put(guide.confirm());
    }

    JsonObject status(Player actor, boolean enabled) {
        var out=new JsonObject();
        out.addProperty("enabled",enabled&&ready()&&allowed(actor));
        var guide=owners.get(actor.getUniqueId());
        if (guide==null) return out;
        out.add("guide",guide.json());
        var maid=loaded(guide);
        out.addProperty("loaded",maid!=null);
        if (maid!=null) {
            out.getAsJsonObject("guide").addProperty("name",maid.getName().getString());
            out.addProperty("soundPackId",maid.getSoundPackId());
            if (guide.confirmed&&ready()) {
                try { out.add("rpg",JsonParser.parseString(ResidentBodyAccess.rpg(guide.body))); }
                catch (RuntimeException loading) { /* The body or profile may still be starting. */ }
            }
        }
        return out;
    }

    JsonArray online() {
        var rows=new JsonArray();
        if (!ready()) return rows;
        for (var actor:Bukkit.getOnlinePlayers()) {
            var guide=owners.get(actor.getUniqueId());
            if (guide!=null&&guide.confirmed&&allowed(actor)) {
                var row=guide.json();
                var maid=loaded(guide);
                row.addProperty("loaded",maid!=null);
                row.addProperty("active",plugin.nativeControlled(guide.body));
                if(maid!=null){
                    row.addProperty("name",maid.getName().getString());
                    row.addProperty("soundPackId",maid.getSoundPackId());
                    try{
                        var rpg=JsonParser.parseString(ResidentBodyAccess.rpg(guide.body)).getAsJsonObject();
                        if(rpg.get("available").getAsBoolean()){
                            row.add("level",rpg.get("level"));
                            if(!rpg.get("className").getAsString().isBlank())row.add("profession",rpg.get("className"));
                        }
                    }catch(RuntimeException unavailable){/* Leave profile facts absent until the real profile is loaded. */}
                }
                rows.add(row);
            }
        }
        return rows;
    }

    private static boolean allowed(Player actor) {
        return actor.isOnline()&&!actor.isDead()
            && (actor.getGameMode()==GameMode.SURVIVAL||actor.getGameMode()==GameMode.ADVENTURE);
    }

    JsonObject claim(Player actor) throws Exception {
        requirePlayer(actor);
        var guide=owners.get(actor.getUniqueId());
        if (guide!=null) return status(actor,true);
        var location=NativeMaidOwnerTravel.safe(actor.getLocation());
        if (location==null) throw new CompatibilityException("unsafe_spawn","请站到开阔的实心地面再领取伙伴。");
        String playerName=actor.getName();
        int last=playerName.offsetByCodePoints(0,Math.min(24-DEFAULT_SUFFIX.length(),playerName.codePointCount(0,playerName.length())));
        guide=new Guide(actor.getUniqueId(),UUID.randomUUID(),name(playerName.substring(0,last)+DEFAULT_SUFFIX),false,0);
        put(guide); // Reserve before spawning; an unknown outcome can only recover this UUID.
        plugin.registerUnifiedBody(guide.body);
        var world=((CraftWorld)location.getWorld()).getHandle();
        var maid=new EntityMaid(world);
        maid.setUUID(guide.body);
        maid.setOwnerUUID(guide.owner);
        maid.setTame(true,false);
        maid.setPersistenceRequired();
        maid.getPersistentData().putString(MARKER,guide.owner.toString());
        maid.setCustomName(net.minecraft.network.chat.Component.literal(guide.name));
        maid.setCustomNameVisible(true);
        maid.moveTo(location.getX(),location.getY(),location.getZ(),actor.getLocation().getYaw(),0);
        NativeMaidKit.initialize(maid);
        if (!world.addFreshEntity(maid,CreatureSpawnEvent.SpawnReason.CUSTOM))
            throw new CompatibilityException("spawn_unconfirmed","服务器尚未确认伙伴入世。请保留这笔领取记录联系服主。");
        plugin.bindGuide(maid);
        seen(maid);
        return status(actor,true);
    }

    EntityMaid requireBody(Player actor) {
        requirePlayer(actor);
        var guide=owners.get(actor.getUniqueId());
        var maid=guide==null||!guide.confirmed?null:loaded(guide);
        if (maid==null) throw new CompatibilityException("guide_unavailable","原伙伴暂不可用。请稍候或回到上次相见处。");
        return maid;
    }
    UUID requireId(Player actor) {
        requirePlayer(actor);
        var guide=owners.get(actor.getUniqueId());
        if(guide==null||!guide.confirmed)throw new CompatibilityException("guide_unavailable","请先领取并确认原伙伴。");
        return guide.body;
    }

    void rename(Player actor,String value) throws Exception {
        var maid=requireBody(actor);
        String next=name(value);
        var old=bodies.get(maid.getUUID());
        put(new Guide(old.owner,old.body,next,true,old.revision));
        maid.setCustomName(net.minecraft.network.chat.Component.literal(next));
    }

    boolean applyWebsiteProfile(UUID owner,UUID id,long revision,String value)throws Exception {
        var old=owners.get(owner);
        if(old==null||!old.confirmed||!old.body.equals(id)||revision<old.revision)return false;
        var actor=Bukkit.getPlayer(owner);
        var maid=loaded(old);
        if(actor==null||!allowed(actor)||maid==null)return false;
        String next=name(value);
        if(revision==old.revision)return old.name.equals(next);
        put(new Guide(owner,id,next,true,revision));
        maid.setCustomName(net.minecraft.network.chat.Component.literal(next));
        return true;
    }

    @EventHandler public void quit(PlayerQuitEvent event){
        var guide=owners.get(event.getPlayer().getUniqueId());
        var maid=guide==null?null:loaded(guide);
        if(guide!=null)plugin.nativeTakeover(event.getPlayer(),guide.body);
        if(maid!=null)park(maid);
    }
    @EventHandler public void join(PlayerJoinEvent event){
        var actor=event.getPlayer();
        var guide=owners.get(actor.getUniqueId());
        var maid=guide==null?null:loaded(guide);
        if(maid!=null)resume(maid);
        for(var entity:actor.getNearbyEntities(64,64,64)){
            var other=HybridMaidPlugin.nativeMaid(entity);
            if(other!=null&&known(other.getUUID())&&other.getPersistentData().contains(PARKED))actor.hideEntity(plugin,entity);
        }
    }
    private void park(EntityMaid maid){
        var data=maid.getPersistentData();
        if(!data.contains(PARKED)){
            var flags=new net.minecraft.nbt.CompoundTag();
            flags.putBoolean("noAi",maid.isNoAi());flags.putBoolean("invisible",maid.isInvisible());
            flags.putBoolean("invulnerable",maid.isInvulnerable());flags.putBoolean("silent",maid.isSilent());
            data.put(PARKED,flags);
        }
        maid.getNavigation().stop();maid.setTarget(null);
        maid.setNoAi(true);maid.setInvisible(true);maid.setInvulnerable(true);maid.setSilent(true);
        for(var viewer:Bukkit.getOnlinePlayers())viewer.hideEntity(plugin,maid.getBukkitEntity());
    }
    private void resume(EntityMaid maid){
        var data=maid.getPersistentData();
        if(!data.contains(PARKED))return;
        var flags=data.getCompound(PARKED);
        maid.setNoAi(flags.getBoolean("noAi"));maid.setInvisible(flags.getBoolean("invisible"));
        maid.setInvulnerable(flags.getBoolean("invulnerable"));maid.setSilent(flags.getBoolean("silent"));
        data.remove(PARKED);
        for(var viewer:Bukkit.getOnlinePlayers())viewer.showEntity(plugin,maid.getBukkitEntity());
    }

    private void requirePlayer(Player actor) {
        if (!ready()||!allowed(actor)) throw new CompatibilityException("guide_disabled","伙伴暂不可领取或管理。");
    }
}
