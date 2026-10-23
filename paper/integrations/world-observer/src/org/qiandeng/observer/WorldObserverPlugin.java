package org.qiandeng.observer;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.events.*;
import com.google.gson.*;
import com.mojang.datafixers.util.Pair;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.netty.buffer.Unpooled;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.GZIPOutputStream;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.*;
import net.minecraft.server.level.ServerEntity;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.GameMode;
import org.bukkit.craftbukkit.CraftServer;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.BlockPhysicsEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.player.PlayerAnimationEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Read-only export of existing players. Never constructs a player, sends a
 * gameplay packet to them, registers a chunk ticket, or opens a public socket.
 * Native packets retain 1.21.1's actual registry/component encoding. */
public final class WorldObserverPlugin extends JavaPlugin implements Listener {
    private static final Gson JSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final int QUEUE_BYTES = 8 * 1024 * 1024, RESPONSE_BYTES = 4 * 1024 * 1024;
    private final Map<UUID, View> views = new LinkedHashMap<>(); // main thread only
    private record DirtyBlock(UUID world, net.minecraft.core.BlockPos position) {}
    private final Set<DirtyBlock> dirtyBlocks = new LinkedHashSet<>();
    private HttpServer http;
    private ThreadPoolExecutor executor;
    private byte[] secret;
    private PacketAdapter packets;
    private int tick, radius, maxViews, roundRobin;
    @SuppressWarnings("rawtypes") private net.minecraft.network.codec.StreamCodec packetCodec;
    private List<String> configurationPackets;
    private Map<String,Object> renderRegistries;
    private long totalEncodeNanos, maxTickNanos;

    private record Wire(long sequence, String packet, int bytes) {}
    private static final class View {
        final UUID uuid;
        final String lease;
        final ArrayDeque<Wire> queue = new ArrayDeque<>();
        final ArrayDeque<Long> pendingChunks = new ArrayDeque<>();
        final Set<Long> sent = new HashSet<>();
        final Map<Long,Integer> chunkTicks = new HashMap<>();
        final Set<Integer> entities = new HashSet<>();
        final Map<Integer, Integer> metadata = new HashMap<>();
        final Map<Integer, Integer> equipment = new HashMap<>();
        final Map<Integer, org.bukkit.Location> positions = new HashMap<>();
        UUID world;
        int centerX = Integer.MIN_VALUE, centerZ, bytes, seenTick;
        long sequence;
        String generation = UUID.randomUUID().toString(), fault;
        View(UUID uuid, String lease, int now) { this.uuid=uuid; this.lease=lease; this.seenTick=now; }
        void reset() {
            queue.clear(); pendingChunks.clear(); sent.clear(); chunkTicks.clear(); entities.clear(); metadata.clear(); equipment.clear(); positions.clear();
            world=null; centerX=Integer.MIN_VALUE; bytes=0; sequence=0; fault=null;
            generation=UUID.randomUUID().toString();
        }
    }

    @Override public void onEnable() {
        saveDefaultConfig();
        if (!Bukkit.getMinecraftVersion().equals("1.21.1")) { getLogger().severe("WorldObserver requires Paper 1.21.1"); Bukkit.getPluginManager().disablePlugin(this); return; }
        if (!getConfig().getBoolean("enabled", false)) { getLogger().info("WorldObserver is disabled; no observer accounts or listeners started"); return; }
        try {
            radius=Math.max(1,Math.min(3,getConfig().getInt("radius-chunks",2)));
            maxViews=Math.max(1,Math.min(4,getConfig().getInt("max-targets",4)));
            Path key=getDataFolder().toPath().resolve("worker.key");
            if (!Files.exists(key)) {
                byte[] random=new byte[32];new SecureRandom().nextBytes(random);
                Files.writeString(key,Base64.getUrlEncoder().withoutPadding().encodeToString(random),StandardOpenOption.CREATE_NEW);
            }
            String value=Files.readString(key).trim();
            if (!value.matches("[A-Za-z0-9_-]{43}")) throw new IllegalStateException("Invalid local worker key");
            secret=value.getBytes(StandardCharsets.US_ASCII);
            var registries=((CraftServer)Bukkit.getServer()).getServer().registryAccess();
            packetCodec=GameProtocols.CLIENTBOUND_TEMPLATE.bind(RegistryFriendlyByteBuf.decorator(registries)).codec();
            renderRegistries=Map.of("source","server_builtin_registries",
                "villagerTypes",net.minecraft.core.registries.BuiltInRegistries.VILLAGER_TYPE.stream().map(entry->Map.of("id",net.minecraft.core.registries.BuiltInRegistries.VILLAGER_TYPE.getId(entry),"name",net.minecraft.core.registries.BuiltInRegistries.VILLAGER_TYPE.getKey(entry).toString())).toList(),
                "villagerProfessions",net.minecraft.core.registries.BuiltInRegistries.VILLAGER_PROFESSION.stream().map(entry->Map.of("id",net.minecraft.core.registries.BuiltInRegistries.VILLAGER_PROFESSION.getId(entry),"name",net.minecraft.core.registries.BuiltInRegistries.VILLAGER_PROFESSION.getKey(entry).toString())).toList());
            configurationPackets=new ArrayList<>();
            net.minecraft.core.RegistrySynchronization.packRegistries(net.minecraft.resources.RegistryOps.create(net.minecraft.nbt.NbtOps.INSTANCE,registries),registries,Set.of(),(registryKey,entries)->{
                var packet=new net.minecraft.network.protocol.configuration.ClientboundRegistryDataPacket(registryKey,entries);
                var buffer=Unpooled.buffer();
                try {net.minecraft.network.protocol.configuration.ConfigurationProtocols.CLIENTBOUND.codec().encode(buffer,packet);
                    byte[] bytes=new byte[buffer.readableBytes()];buffer.readBytes(bytes);configurationPackets.add(Base64.getEncoder().encodeToString(bytes));
                } finally {buffer.release();}
            });
            http=HttpServer.create(new InetSocketAddress("127.0.0.1",getConfig().getInt("port",28994)),8);
            executor=new ThreadPoolExecutor(1,2,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(8),r->{Thread t=new Thread(r,"world-observer-http");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
            http.setExecutor(executor);http.createContext("/v1/poll",this::handle);http.start();
            Bukkit.getPluginManager().registerEvents(this,this);
            // These are observations already sent to the real player. Private
            // chat, commands, authentication, menus and arbitrary custom payloads
            // deliberately have no route into this public scene transport.
            packets=new PacketAdapter(this,ListenerPriority.MONITOR,
                PacketType.Play.Server.BLOCK_CHANGE,PacketType.Play.Server.MULTI_BLOCK_CHANGE,
                PacketType.Play.Server.TILE_ENTITY_DATA,PacketType.Play.Server.WORLD_PARTICLES,
                PacketType.Play.Server.NAMED_SOUND_EFFECT,PacketType.Play.Server.ENTITY_SOUND,
                PacketType.Play.Server.ANIMATION,PacketType.Play.Server.HURT_ANIMATION) {
                @Override public void onPacketSending(PacketEvent event) {
                    if (event.isCancelled() || event.isPlayerTemporary()) return;
                    // ProtocolLib may call on a Netty thread. The callback only
                    // schedules a bounded native packet; it never reads world state.
                    if (!Bukkit.isPrimaryThread()) return;
                    View view=views.get(event.getPlayer().getUniqueId());
                    if (view!=null && view.fault==null && view.world!=null) add(view,(Packet<?>)event.getPacket().getHandle());
                }
            };
            ProtocolLibrary.getProtocolManager().addPacketListener(packets);
            Bukkit.getScheduler().runTaskTimer(this,this::tick,1,1);
            getLogger().info("Read-only scene export ready on loopback; no Minecraft player connection created");
        } catch (Exception error) { getLogger().severe("WorldObserver startup failed: "+error.getClass().getSimpleName()); Bukkit.getPluginManager().disablePlugin(this); }
    }
    @Override public void onDisable() {
        if(packets!=null)ProtocolLibrary.getProtocolManager().removePacketListener(packets);
        if(http!=null)http.stop(0); if(executor!=null)executor.shutdownNow(); views.clear();dirtyBlocks.clear();
    }
    private void handle(HttpExchange exchange) throws IOException {
        try {
            if(!exchange.getRequestMethod().equals("POST") || !exchange.getRequestURI().toString().equals("/v1/poll")
                || exchange.getRequestHeaders().containsKey("Origin") || exchange.getRequestHeaders().containsKey("Cookie")) { respond(exchange,403,Map.of("reason","LOCAL_WORKER_REQUIRED")); return; }
            String header=exchange.getRequestHeaders().getFirst("Authorization");
            if(header==null || !header.startsWith("Bearer ") || !MessageDigest.isEqual(secret,header.substring(7).getBytes(StandardCharsets.US_ASCII))) { respond(exchange,401,Map.of("reason","LOCAL_WORKER_REQUIRED"));return; }
            byte[] bytes=exchange.getRequestBody().readNBytes(16385);
            if(bytes.length>16384) {respond(exchange,413,Map.of("reason","REQUEST_LIMIT"));return;}
            JsonObject request=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
            if(request.get("schemaVersion").getAsInt()!=1 || !request.has("targets") || request.getAsJsonArray("targets").size()>maxViews) throw new IllegalArgumentException();
            Future<Map<String,Object>> task=Bukkit.getScheduler().callSyncMethod(this,()->poll(request));
            try {respond(exchange,200,task.get(4,TimeUnit.SECONDS));}
            catch(TimeoutException timeout) {task.cancel(false);respond(exchange,503,Map.of("reason","SERVER_BUSY"));}
        } catch (IllegalArgumentException | NullPointerException | IllegalStateException bad) {respond(exchange,400,Map.of("reason","REQUEST_INVALID"));}
        catch(Exception error) {respond(exchange,503,Map.of("reason","SOURCE_UNAVAILABLE"));}
        finally {exchange.close();}
    }
    private void respond(HttpExchange exchange,int status,Object value) throws IOException {
        byte[] body=JSON.toJson(value).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type","application/json");
        exchange.getResponseHeaders().set("Cache-Control","no-store");
        exchange.getResponseHeaders().set("Content-Encoding","gzip");
        exchange.sendResponseHeaders(status,0);
        try(var out=new GZIPOutputStream(exchange.getResponseBody())) {out.write(body);}
    }
    private Map<String,Object> poll(JsonObject request) {
        List<Map<String,Object>> replies=new ArrayList<>(); Set<UUID> seen=new HashSet<>(); int budget=RESPONSE_BYTES;
        for(JsonElement entry:request.getAsJsonArray("targets")) {
            JsonObject row=entry.getAsJsonObject();UUID uuid=UUID.fromString(row.get("uuid").getAsString());
            String lease=row.get("lease").getAsString();UUID.fromString(lease);
            long after=row.has("after")?row.get("after").getAsLong():0;
            if(after<0 || !seen.add(uuid))throw new IllegalArgumentException();
            Player player=Bukkit.getPlayer(uuid);
            if(player==null || !player.isOnline() || player.getGameMode()==GameMode.SPECTATOR) {
                views.remove(uuid);replies.add(Map.of("uuid",uuid.toString(),"available",false,"reason","TARGET_OFFLINE"));continue;
            }
            View view=views.get(uuid);
            if(view==null || !view.lease.equals(lease)) {
                if(view==null && views.size()>=maxViews) {replies.add(Map.of("uuid",uuid.toString(),"available",false,"reason","SOURCE_CAPACITY"));continue;}
                view=new View(uuid,lease,tick);views.put(uuid,view);
            }
            view.seenTick=tick;
            String generation=row.has("generation")&&!row.get("generation").isJsonNull()?row.get("generation").getAsString():null;
            if(generation!=null && (!generation.equals(view.generation) || after>view.sequence)) after=0;
            if(view.fault!=null) {view.reset();after=0;}
            // A fresh broker can request a baseline; never silently bridge a
            // missing packet range or pretend an unloaded column is air.
            if(after==0 && generation!=null && generation.equals(view.generation) && view.queue.isEmpty() && view.sequence>0) view.reset();
            while(!view.queue.isEmpty() && view.queue.peek().sequence<=after) {Wire old=view.queue.remove();view.bytes-=old.bytes;}
            List<Map<String,Object>> wire=new ArrayList<>();
            for(Wire packet:view.queue) {if(packet.sequence<=after)continue;if(packet.bytes>budget)break;wire.add(Map.of("sequence",packet.sequence,"data",packet.packet));budget-=packet.bytes;}
            Map<String,Object> reply=new LinkedHashMap<>();reply.put("uuid",uuid.toString());reply.put("lease",view.lease);
            reply.put("generation",view.generation);reply.put("available",true);reply.put("player",playerState(player));reply.put("packets",wire);
            if(after==0)reply.put("configurationPackets",configurationPackets);
            reply.put("initializing",!view.pendingChunks.isEmpty() || view.sent.isEmpty());replies.add(reply);
        }
        return Map.of("schemaVersion",1,"minecraftVersion","1.21.1","targets",replies,"metrics",Map.of("activeTargets",views.size(),"minecraftConnectionsCreated",0,"encodeMillis",totalEncodeNanos/1_000_000.0,"maxTickMillis",maxTickNanos/1_000_000.0));
    }
    private Map<String,Object> playerState(Player player) {
        ServerPlayer p=((CraftPlayer)player).getHandle(); var loc=player.getLocation();var level=p.serverLevel();
        Map<String,Object> value=new LinkedHashMap<>();
        value.put("uuid",player.getUniqueId().toString());value.put("name",player.getName());value.put("entityId",player.getEntityId());
        value.put("hasCustomTextures",!p.getGameProfile().getProperties().get("textures").isEmpty());
        // Vanilla sends this hashed biome seed in the login/respawn packet. The
        // renderer needs it for exact grass/foliage biome selection; never export
        // the raw world seed or invent a default biome for missing data.
        value.put("world",Map.of("uuid",player.getWorld().getUID().toString(),"name",level.dimension().location().toString(),"minY",player.getWorld().getMinHeight(),"height",player.getWorld().getMaxHeight()-player.getWorld().getMinHeight(),"hashedSeed",Long.toString(net.minecraft.world.level.biome.BiomeManager.obfuscateSeed(level.getSeed()))));
        value.put("renderRegistries",renderRegistries);
        value.put("position",Map.of("x",loc.getX(),"y",loc.getY(),"z",loc.getZ()));
        value.put("yawDegrees",loc.getYaw());value.put("pitchDegrees",loc.getPitch());value.put("eyeHeight",player.getEyeHeight());
        value.put("health",player.getHealth());value.put("food",player.getFoodLevel());value.put("experienceLevel",player.getLevel());value.put("experienceProgress",player.getExp());
        value.put("onGround",player.isOnGround());value.put("sneaking",player.isSneaking());value.put("sprinting",player.isSprinting());value.put("flying",player.isFlying());
        value.put("maxHealth",p.getMaxHealth());value.put("armor",p.getArmorValue());value.put("usingItem",p.isUsingItem());value.put("useItemRemainingTicks",p.getUseItemRemainingTicks());
        value.put("spinAttack",p.isAutoSpinAttack());value.put("observedAt",System.currentTimeMillis());value.put("serverTick",tick);
        if(p.isUsingItem()) {
            var using=p.getUseItem();value.put("useItemDurationTicks",using.getUseDuration(p));
            value.put("useItemAnimation",using.getUseAnimation().name().toLowerCase(Locale.ROOT));
            value.put("activeHand",p.getUsedItemHand()==net.minecraft.world.InteractionHand.OFF_HAND?"offhand":"mainhand");
            value.put("activeItemName",net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(using.getItem()).toString());
        }
        value.put("attackAnim",p.getAttackAnim(1));value.put("mainArm",p.getMainArm().toString().toLowerCase(Locale.ROOT));
        value.put("airSupply",p.getAirSupply());value.put("maxAirSupply",p.getMaxAirSupply());value.put("inWater",p.isInWater());
        value.put("bodyYaw",p.yBodyRot);value.put("headYaw",p.getYHeadRot());value.put("pose",p.getPose().ordinal());
        value.put("gameTime",level.getGameTime());value.put("dayTime",level.getDayTime());
        value.put("velocity",Map.of("x",player.getVelocity().getX(),"y",player.getVelocity().getY(),"z",player.getVelocity().getZ()));
        value.put("selectedHotbarSlot",player.getInventory().getHeldItemSlot());
        List<Map<String,Object>> inventory=new ArrayList<>();
        for(int slot=0;slot<46;slot++) {
            var stack=p.inventoryMenu.getSlot(slot).getItem();Map<String,Object> item=new LinkedHashMap<>();item.put("slot",slot);
            if(!stack.isEmpty())item.put("item",Map.of("name",net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),"count",stack.getCount(),"snbt",stack.saveOptional(level.registryAccess()).toString()));
            else item.put("item",null); inventory.add(item);
        }
        value.put("inventory",inventory);
        value.put("scope",isNumen(player)?"loaded_region_visible_entities":"target_sent_chunks_and_tracked_entities");
        return value;
    }
    private boolean isNumen(Player player) {return player.getClass().getName().startsWith("com.dwinovo.numen.") || ((CraftPlayer)player).getHandle().getClass().getName().startsWith("com.dwinovo.numen.");}
    private Set<Long> visibleChunks(Player player) {
        if(isNumen(player)) {
            Set<Long> loaded=new HashSet<>();int x=player.getLocation().getBlockX()>>4,z=player.getLocation().getBlockZ()>>4;
            for(int dx=-radius;dx<=radius;dx++)for(int dz=-radius;dz<=radius;dz++)if(player.getWorld().isChunkLoaded(x+dx,z+dz))loaded.add(Chunk.getChunkKey(x+dx,z+dz));
            return loaded;
        }
        return player.getSentChunkKeys();
    }
    private void tick() {
        tick++;long started=System.nanoTime();boolean encodedChunk=false;
        // Numen bodies have no socket for ProtocolLib to tap. Coalesce actual
        // Bukkit block changes into the next tick instead of fabricating air or
        // requiring an Eye. Periodic native chunk refresh below covers changes
        // without a Bukkit event (for example another plugin's block edits).
        for(DirtyBlock dirty:dirtyBlocks)for(View view:views.values()) {
            Player p=Bukkit.getPlayer(view.uuid);
            if(p==null || !isNumen(p) || !dirty.world.equals(view.world) || !view.sent.contains(Chunk.getChunkKey(dirty.position.getX()>>4,dirty.position.getZ()>>4)))continue;
            var level=((CraftPlayer)p).getHandle().serverLevel();var chunk=level.getChunkSource().getChunkNow(dirty.position.getX()>>4,dirty.position.getZ()>>4);
            if(chunk!=null)add(view,new ClientboundBlockUpdatePacket(dirty.position,chunk.getBlockState(dirty.position)));
        }
        dirtyBlocks.clear();
        var work=new ArrayList<>(views.values());int count=work.size();
        for(int i=0;i<count;i++) {
            View view=work.get((roundRobin+i)%count);Player player=Bukkit.getPlayer(view.uuid);
            if(tick-view.seenTick>160 || player==null || !player.isOnline() || player.getGameMode()==GameMode.SPECTATOR) {views.remove(view.uuid);continue;}
            if(view.fault!=null)continue;
            if(!player.getWorld().getUID().equals(view.world)) {view.reset();view.world=player.getWorld().getUID();}
            int cx=player.getLocation().getBlockX()>>4,cz=player.getLocation().getBlockZ()>>4;
            if(cx!=view.centerX || cz!=view.centerZ || tick%20==0) {
                view.centerX=cx;view.centerZ=cz;Set<Long> visible=visibleChunks(player),wanted=new HashSet<>();List<Long> pending=new ArrayList<>();
                for(int dx=-radius;dx<=radius;dx++)for(int dz=-radius;dz<=radius;dz++) {
                    long key=Chunk.getChunkKey(cx+dx,cz+dz);if(!visible.contains(key))continue;wanted.add(key);
                    if(!view.sent.contains(key) || isNumen(player) && tick-view.chunkTicks.getOrDefault(key,tick)>=100)pending.add(key);
                }
                for(Iterator<Long> old=view.sent.iterator();old.hasNext();) {long key=old.next();if(!wanted.contains(key)){add(view,new ClientboundForgetLevelChunkPacket(new net.minecraft.world.level.ChunkPos(key)));view.chunkTicks.remove(key);old.remove();}}
                pending.sort(Comparator.comparingInt(key->{int x=(int)(long)key,z=(int)(key>>32);return (x-cx)*(x-cx)+(z-cz)*(z-cz);}));
                view.pendingChunks.clear();view.pendingChunks.addAll(pending);
            }
            if(!encodedChunk && !view.pendingChunks.isEmpty()) {
                long key=view.pendingChunks.remove();var level=((CraftPlayer)player).getHandle().serverLevel();
                var chunk=level.getChunkSource().getChunkNow((int)key,(int)(key>>32));
                if(chunk!=null && visibleChunks(player).contains(key)) {add(view,new ClientboundLevelChunkWithLightPacket(chunk,level.getLightEngine(),null,null,false));view.sent.add(key);view.chunkTicks.put(key,tick);}
                encodedChunk=true;
            }
            if(tick%4==0)updateEntities(view,player);
            // Encoding is indivisible, but never start another target's work
            // after this tick's measured two-millisecond observation budget.
            if(System.nanoTime()-started>=2_000_000)break;
        }
        if(count>0)roundRobin=(roundRobin+1)%count;
        maxTickNanos=Math.max(maxTickNanos,System.nanoTime()-started);
    }
    private void updateEntities(View view,Player player) {
        var level=((CraftPlayer)player).getHandle().serverLevel();Set<Integer> current=new HashSet<>();int limit=0;
        for(Entity bukkit:player.getNearbyEntities(32,24,32)) {
            if(limit>=128)break;
            if(bukkit instanceof Player p && p.getGameMode()==GameMode.SPECTATOR)continue;
            if(!player.canSee(bukkit))continue;
            if(isNumen(player)) {if(bukkit instanceof LivingEntity living && !player.hasLineOfSight(living))continue;}
            else if(!bukkit.getTrackedBy().contains(player))continue;
            var entity=((CraftEntity)bukkit).getHandle();int id=entity.getId();current.add(id);limit++;
            if(view.entities.add(id)) {
                var tracker=new ServerEntity(level,entity,1,false,packet->{},new HashSet<>());
                add(view,entity.getAddEntityPacket(tracker));
            }
            var location=bukkit.getLocation();
            if(!location.equals(view.positions.put(id,location)))add(view,new ClientboundTeleportEntityPacket(entity));
            // packAll is read-only. Non-default values alone cannot clear an
            // earlier non-default flag (name visibility, crouch, fire, etc.).
            // Never call packDirty: it would consume the real player's updates.
            var data=entity.getEntityData().packAll();
            if(data!=null) {int hash=data.toString().hashCode();if(!Objects.equals(view.metadata.put(id,hash),hash))add(view,new ClientboundSetEntityDataPacket(id,data));}
            if(entity instanceof net.minecraft.world.entity.LivingEntity living) {
                List<Pair<EquipmentSlot,net.minecraft.world.item.ItemStack>> items=new ArrayList<>();
                for(EquipmentSlot slot:EquipmentSlot.values())if(slot!=EquipmentSlot.BODY)items.add(Pair.of(slot,living.getItemBySlot(slot)));
                int hash=1;for(var item:items)hash=31*hash+Objects.hash(item.getFirst(),item.getSecond().getItem(),item.getSecond().getCount(),item.getSecond().getComponents());
                if(!Objects.equals(view.equipment.put(id,hash),hash))add(view,new ClientboundSetEquipmentPacket(id,items));
            }
        }
        int[] removed=view.entities.stream().filter(id->!current.contains(id)).mapToInt(Integer::intValue).toArray();
        if(removed.length>0) {add(view,new ClientboundRemoveEntitiesPacket(removed));for(int id:removed){view.entities.remove(id);view.metadata.remove(id);view.equipment.remove(id);view.positions.remove(id);}}
    }
    private void add(View view,Packet<?> packet) {
        if(view.fault!=null)return;
        long start=System.nanoTime();
        var buffer=Unpooled.buffer();
        try {
            packetCodec.encode(buffer,packet);
            int size=buffer.readableBytes();if(size>2*1024*1024 || view.bytes+size>QUEUE_BYTES){view.fault="OBSERVATION_BACKPRESSURE";return;}
            byte[] bytes=new byte[size];buffer.readBytes(bytes);
            view.queue.add(new Wire(++view.sequence,Base64.getEncoder().encodeToString(bytes),size));view.bytes+=size;
        } catch(Exception error) {view.fault="OBSERVATION_PACKET_UNAVAILABLE";}
        finally {buffer.release();totalEncodeNanos+=System.nanoTime()-start;}
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void animation(PlayerAnimationEvent event) {
        Player player=event.getPlayer();var source=((CraftPlayer)player).getHandle();
        for(View view:views.values())if(view.uuid.equals(player.getUniqueId()) || view.entities.contains(player.getEntityId()))add(view,new ClientboundAnimatePacket(source,0));
    }
    @EventHandler public void quit(PlayerQuitEvent event) {views.remove(event.getPlayer().getUniqueId());}
    private void changed(org.bukkit.block.Block block) {
        if(views.isEmpty() || dirtyBlocks.size()>=64)return;
        dirtyBlocks.add(new DirtyBlock(block.getWorld().getUID(),new net.minecraft.core.BlockPos(block.getX(),block.getY(),block.getZ())));
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void broken(BlockBreakEvent event) {changed(event.getBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void placed(BlockPlaceEvent event) {changed(event.getBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void physics(BlockPhysicsEvent event) {changed(event.getBlock());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void entityBlock(EntityChangeBlockEvent event) {changed(event.getBlock());}
}
