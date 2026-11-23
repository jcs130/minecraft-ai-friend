package local.hosting;

import com.google.gson.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import local.hosting.NativeShellCustody.Binding;
import local.hosting.NativeShellCustody.Operation;

/** Explicit original bodies. All decisions and disk transitions are serialized by the game thread. */
final class NativeResidentSlots {
    private static final Set<String> FIELDS=Set.of("phase","kind","bodyId","entityUuid","operationId","characterId","ownerId","generation");
    private static final Set<String> MUTATIONS=Set.of("fence","cancel","park","admit","resume");
    private static final long ADMISSION_LIFETIME=java.util.concurrent.TimeUnit.SECONDS.toNanos(120);
    private record Body(Binding binding,String dimension,String issuer) {}
    private record Role(JsonObject scope,UUID owner,UUID controller,Map<String,Body> bodies,
                        Map<String,NativePlayerCustody.PlayerBody> players) {}
    private record Prepared(String id,long generation,String target,long until) {}
    private final Map<String,Role> roles=new HashMap<>();
    private final Map<String,Prepared> prepared=new HashMap<>();
    private final MinecraftServer game;
    private final Path directory;

    NativeResidentSlots(MinecraftServer game,JsonArray list) throws Exception {
        this.game=game;
        directory=NativeCustodyFence.directory(game).resolve("role-slots");
        if (list==null || list.isEmpty() || list.size()>24) throw new IllegalArgumentException("Explicit roles required");
        var originals=new HashSet<UUID>();
        var controllers=new HashSet<UUID>();
        for (var row:list) {
            JsonObject s=row.getAsJsonObject();
            String charId=text(s,"characterId");
            UUID owner=uuid(s,"ownerId"),controller=uuid(s,"controllerId");
            var bodies=new HashMap<String,Body>();
            var bodyIds=new HashSet<String>();
            for (String kind:NativePlayerCustody.NATIVE_KINDS) {
                if (!s.has(kind)) continue;
                var entry=s.getAsJsonObject(kind); boolean maid=kind.equals("maid");
                var b=new Binding(charId,owner,text(entry,"bodyId"),uuid(entry,"entityUuid"),
                        maid?"touhou_little_maid:maid":"minecraft:villager",maid?uuid(entry,"nativeOwner"):null);
                if (!originals.add(b.entityUuid()) || !bodyIds.add(b.bodyId())) throw new IllegalArgumentException("Duplicate original body");
                String dim=text(entry,"dimension"); ResourceLocation.parse(dim);
                bodies.put(kind,new Body(b,dim,maid?null:text(entry,"issuer")));
            }
            var players=NativePlayerCustody.bindings(s);
            NativePlayerCustody.requireRegistered(charId,players);
            if (!players.isEmpty() && !originals.add(players.values().iterator().next().uuid()))
                throw new IllegalArgumentException("Duplicate original player");
            for (var player:players.values()) if (!bodyIds.add(player.bodyId())) throw new IllegalArgumentException("Repeated body ID");
            if (bodies.isEmpty() || bodyIds.size()<2 || !controllers.add(controller)
                    || roles.put(charId,new Role(s,owner,controller,Map.copyOf(bodies),players))!=null)
                throw new IllegalArgumentException("Repeated native role registration");
        }
    }

    JsonObject handle(JsonObject request) throws Exception {
        if (!game.isSameThread()) throw new SecurityException();
        boolean lookup="result".equals(text(request,"phase"));
        if (lookup) {
            request=request.deepCopy();
            var original=request.remove("originalPhase");
            if (original==null || !original.isJsonPrimitive() || !original.getAsJsonPrimitive().isString() ||
                !MUTATIONS.contains(original.getAsString())) throw new SecurityException();
            request.add("phase",original);
        }
        if (!request.keySet().equals(FIELDS)) throw new SecurityException();
        String phase=text(request,"phase"),kind=text(request,"kind"),character=text(request,"characterId");
        if (!Set.of("inspect","assets").contains(phase) && !MUTATIONS.contains(phase)) throw new SecurityException();
        Role role=roles.get(character);
        Body body=role==null?null:role.bodies.get(kind);
        var player=role==null?null:role.players.get(kind);
        if (role==null || body==null && player==null || !role.owner.equals(uuid(request,"ownerId"))
                || !(body==null?player.bodyId():body.binding.bodyId()).equals(text(request,"bodyId"))
                || !(body==null?player.uuid():body.binding.entityUuid()).equals(uuid(request,"entityUuid")))
            throw new SecurityException();
        if (!request.get("generation").isJsonPrimitive() || !request.getAsJsonPrimitive("generation").isNumber() ||
            !request.get("generation").getAsString().matches("[1-9][0-9]{0,15}")) throw new SecurityException();
        var op=new Operation(text(request,"operationId"),request.get("generation").getAsLong());
        if (op.generation()>9_007_199_254_740_990L) throw new SecurityException();
        Path root=directory.resolve(hash(character));
        Path slotFile=root.resolve("slot.json");
        // Offline enrollment records the same exact scope, initial body/epoch and audited parked hashes.
        // A missing slot after a crash must never be recreated from a default body.
        var state=NativeResidentHandoffPort.read(slotFile,65536);
        if (!role.scope.equals(state.get("scope"))) throw new SecurityException();
        if (phase.equals("assets")) {
            return CanonicalRoleAssets.read(request,role.scope,state,CanonicalRoleAssets::readPlugin);
        }
        Path receipts=root.resolve("receipts");
        if (!phase.equals("inspect")) {
            var known=readOriginal(receipts,state.getAsJsonObject("last"),request);
            if (known!=null) return known;
            if (lookup) return status(request,"unknown");
        }
        long generation=state.get("generation").getAsLong();
        String active=state.get("activeKind").getAsString();
        var digests=state.getAsJsonObject("held");
        if (phase.equals("inspect")) {
            var out=request.deepCopy();
            boolean ready=!state.has("pending") && !state.has("transfer") && !state.has("playerGate") &&
                    !active.equals(kind) && (role.bodies.containsKey(active) || role.players.containsKey(active)) &&
                    generation==op.generation() && destinationReady(role,state,kind,generation+1);
            out.addProperty("available",ready);
            if (ready) {
                if (player==null) addParked(out,text(digests,kind));
                else if (role.bodies.containsKey(active)) addParked(out,text(state,"playerSnapshot"));
                else {
                    out.addProperty("physicalState","shared_original");
                    out.addProperty("controllerState","reserved_after_release");
                }
                // Preflight proves the other original before allowing this machine to park its source.
                prepared.put(character,new Prepared(op.id(),generation,kind,System.currentTimeMillis()+60_000));
            }
            return out;
        }
        Files.createDirectories(receipts);
        if (state.has("last")) preserveLast(receipts,state.getAsJsonObject("last"));
        // A prepared original survives a timeout or reboot. No request, including a duplicate,
        // may dispatch a new world mutation until the pending result has been reconciled.
        if (state.has("pending")) return status(request,"unknown");
        var transfer=state.has("transfer")?state.getAsJsonObject("transfer"):null;
        var plan=prepared.get(character);
        if (player!=null) return playerPhase(request,phase,role,player,op,active,generation,plan,state,slotFile,receipts);
        if (!Set.of("park","resume").contains(phase) || state.has("playerGate")) return status(request,"unknown");
        ServerLevel level=level(body);
        if (level==null) return status(request,"unknown");
        boolean acquiring=phase.equals("resume");
        boolean permitted=generation==op.generation() && (acquiring
                ? active.isEmpty() && transfer!=null && op.id().equals(text(transfer,"id")) && kind.equals(text(transfer,"target"))
                : active.equals(kind) && transfer==null && plan!=null && !plan.target.equals(kind) &&
                  plan.id.equals(op.id()) && plan.generation==generation && plan.until>=System.currentTimeMillis());
        if (!permitted) return status(request,"unknown");
        String oldLease=(!acquiring && body.binding.nativeOwner()!=null)
                ? NativeResidentDriver.currentMaidGeneration(body.binding,role.controller):null;
        var driver=new NativeResidentDriver(new NativeResidentDriver.Slot() {
            public boolean permits(Binding b,Operation o,boolean a) { return b.equals(body.binding) && op.equals(o) && a==acquiring; }
            public UUID nativeController(Binding b) { return role.controller; }
            public String sourceMaidGeneration(Binding b) { return oldLease; }
            public String villagerIssuer(Binding b) { return body.issuer; }
            // The durable slot and terminal receipt commit together after the game has verified the physical result.
            public void released(Binding b,Operation o) {}
            public void acquired(Binding b,Operation o,String lease) {}
        });
        if (!acquiring) {
            if (!destinationReady(role,state,plan.target,generation+1)) return status(request,"unknown");
            if (!NativeShellCustody.activeOriginal(level,body.binding) || body.binding.nativeOwner()!=null && oldLease==null)
                return status(request,"unknown");
            var source=level.getEntity(body.binding.entityUuid());
            // A verified open native trading window has not changed the enrolled body or its native owner.
            if (NativeShellCustody.physicallyBusy(source)) {
                var refusal=status(request,"blocked");
                refusal.addProperty("effectsApplied",false);
                refusal.addProperty("physicalState","active");
                refusal.addProperty("controllerState","exclusive");
                preserveLast(receipts,refusal);
                return refusal;
            }
            if (!driver.quiescent(body.binding,op,source)) return status(request,"unknown");
        } else if (!digests.has(kind) || !NativeShellCustody.parked(level,body.binding,generation,text(digests,kind)) ||
                   !driver.reserved(body.binding,op)) return status(request,"unknown");
        state.add("pending",request.deepCopy());
        writeState(slotFile,role,state,0);
        try {
            var physical=acquiring
                    ?NativeShellCustody.resume(level,body.binding,op,text(digests,kind),driver)
                    :NativeShellCustody.park(level,body.binding,op,driver);
            var out=status(request,"committed");
            out.addProperty("durable",true);
            if (acquiring) {
                out.addProperty("physicalState","active"); out.addProperty("controllerState","exclusive");
                out.addProperty("originalIdentityVerified",true); out.addProperty("snapshotRestored",true);
                digests.remove(kind); state.addProperty("activeKind",kind); state.remove("transfer");
            } else {
                addParked(out,physical.snapshotSha256());digests.addProperty(kind,physical.snapshotSha256());
                beginTransfer(state,op,plan.target);
                prepared.remove(character);
            }
            state.remove("pending");
            return commit(slotFile,receipts,role,state,out,0);
        } catch (Exception | LinkageError uncertainty) {
            return status(request,"unknown");
        }
    }
    private JsonObject playerPhase(JsonObject request,String phase,Role role,NativePlayerCustody.PlayerBody player,
                                   Operation op,String active,long generation,Prepared plan,JsonObject state,
                                   Path slotFile,Path receipts) throws Exception {
        if (generation!=op.generation()) return status(request,"unknown");
        var gate=state.getAsJsonObject("playerGate");
        boolean exactGate=gate!=null && op.id().equals(text(gate,"id")) && player.kind().equals(text(gate,"kind"))
                && generation==gate.get("generation").getAsLong();
        var transfer=state.getAsJsonObject("transfer");
        boolean successor=active.isEmpty() && transfer!=null && op.id().equals(text(transfer,"id"))
                && player.kind().equals(text(transfer,"target"));
        var out=status(request,"committed");
        out.addProperty("durable",true);
        long liveUntil=0;
        switch (phase) {
            case "fence" -> {
                if (!active.equals(player.kind()) || gate!=null || transfer!=null || plan==null ||
                        !op.id().equals(plan.id) || generation!=plan.generation || plan.until<System.currentTimeMillis() ||
                        !NativePlayerCustody.joined(game,player) || !destinationReady(role,state,plan.target,generation+1))
                    return status(request,"unknown");
                state.add("playerGate",newGate(op,player.kind(),"fenced",plan.target));
                out.addProperty("controllerState","fenced");
            }
            case "cancel" -> {
                if (!active.equals(player.kind()) || !exactGate || !text(gate,"mode").equals("fenced") ||
                        !NativePlayerCustody.joined(game,player)) return status(request,"unknown");
                state.remove("playerGate");
                prepared.remove(text(role.scope,"characterId"));
                out.addProperty("physicalState","active"); out.addProperty("controllerState","exclusive");
            }
            case "park" -> {
                if (!active.equals(player.kind()) || !exactGate || !text(gate,"mode").equals("fenced") ||
                        !NativePlayerCustody.offline(game,player)) return status(request,"unknown");
                // The signed coordinator attests the exact stock save/detach result. The game also
                // checks original offline identity and remembers the actual untouched file digest.
                String digest=NativePlayerCustody.savedDigest(game,player);
                state.addProperty("playerSnapshot",digest);
                state.remove("playerGate");
                beginTransfer(state,op,text(gate,"target"));
                prepared.remove(text(role.scope,"characterId"));
                addParked(out,digest);
            }
            case "admit" -> {
                if (!successor || gate!=null || !destinationReady(role,state,player.kind(),generation))
                    return status(request,"unknown");
                NativePlayerCustody.requireNativeHolds(role.scope,state);
                state.add("playerGate",newGate(op,player.kind(),"admitted",player.kind()));
                liveUntil=System.nanoTime()+ADMISSION_LIFETIME;
                out.addProperty("controllerState","reserved");
            }
            case "resume" -> {
                if (!successor || !exactGate || !text(gate,"mode").equals("admitted") ||
                        !NativePlayerCustody.admissionOpen(player) || !NativePlayerCustody.joined(game,player))
                    return status(request,"unknown");
                NativePlayerCustody.requireNativeHolds(role.scope,state);
                state.addProperty("activeKind",player.kind());state.remove("transfer");
                state.remove("playerGate");state.remove("playerSnapshot");
                out.addProperty("physicalState","active");out.addProperty("controllerState","exclusive");
                out.addProperty("originalIdentityVerified",true);out.addProperty("snapshotRestored",true);
            }
            default -> { return status(request,"unknown"); }
        }
        return commit(slotFile,receipts,role,state,out,liveUntil);
    }
    private boolean destinationReady(Role role,JsonObject state,String kind,long successorGeneration) throws Exception {
        var body=role.bodies.get(kind);
        if (body!=null) {
            var dimension=level(body);
            var held=state.getAsJsonObject("held");
            return dimension!=null && held.has(kind) &&
                    NativeShellCustody.parked(dimension,body.binding,successorGeneration,text(held,kind));
        }
        var player=role.players.get(kind);
        if (player==null) return false;
        var current=role.players.get(text(state,"activeKind"));
        if (current!=null) return NativePlayerCustody.joined(game,current);
        return state.has("playerSnapshot") && NativePlayerCustody.offline(game,player)
                && text(state,"playerSnapshot").equals(NativePlayerCustody.savedDigest(game,player));
    }
    private ServerLevel level(Body body) {
        return game.getLevel(ResourceKey.create(Registries.DIMENSION,ResourceLocation.parse(body.dimension)));
    }
    private static JsonObject newGate(Operation op,String kind,String mode,String target) {
        var gate=new JsonObject();gate.addProperty("id",op.id());gate.addProperty("kind",kind);
        gate.addProperty("generation",op.generation());gate.addProperty("mode",mode);gate.addProperty("target",target);
        return gate;
    }
    private static void beginTransfer(JsonObject state,Operation op,String target) {
        state.addProperty("activeKind","");state.addProperty("generation",op.generation()+1);
        var transfer=new JsonObject();transfer.addProperty("id",op.id());transfer.addProperty("target",target);
        state.add("transfer",transfer);
    }
    private static void writeState(Path slotFile,Role role,JsonObject state,long liveUntil) throws IOException {
        write(slotFile,state,true);
        NativePlayerCustody.publish(text(role.scope,"characterId"),role.players,state,liveUntil);
    }
    private static JsonObject commit(Path slotFile,Path receipts,Role role,JsonObject state,JsonObject out,long liveUntil) throws Exception {
        state.add("last",out);
        writeState(slotFile,role,state,liveUntil);
        preserveLast(receipts,out);
        return out;
    }
    private static void addParked(JsonObject out,String digest) {
        out.addProperty("physicalState","parked");out.addProperty("controllerState","fenced");
        out.addProperty("recoveryAdmission","held_in_all_worlds");out.addProperty("snapshotSha256",digest);
    }
    private static JsonObject status(JsonObject request,String state) {
        var out=request.deepCopy();out.addProperty("state",state);return out;
    }
    static JsonObject readOriginal(Path receipts,JsonObject last,JsonObject request) throws Exception {
        if (last!=null && text(last,"operationId").equals(text(request,"operationId")) && text(last,"phase").equals(text(request,"phase"))) {
            if (!same(last,request)) throw new SecurityException();
            return last;
        }
        Path file=receiptFile(receipts,request);
        if (!Files.exists(file)) return null;
        var known=NativeResidentHandoffPort.read(file,8192);
        if (!same(known,request)) throw new SecurityException();
        return known;
    }
    static void preserveLast(Path receipts,JsonObject last) throws Exception {
        Path dst=receiptFile(receipts,last);
        if (!Files.exists(dst)) write(dst,last,false);
        if (!last.equals(NativeResidentHandoffPort.read(dst,8192))) throw new IOException("Conflicting original receipt");
    }
    private static Path receiptFile(Path root,JsonObject req) throws Exception {
        return root.resolve(hash(text(req,"operationId")+"\n"+text(req,"phase"))+".json");
    }
    private static boolean same(JsonObject receipt,JsonObject req) {
        return FIELDS.stream().allMatch(key->Objects.equals(receipt.get(key),req.get(key)));
    }
    private static void write(Path file,JsonObject value,boolean replace) throws IOException {
        var temp=Files.createTempFile(file.getParent(),"writing-",".tmp");
        try {
            try(var out=FileChannel.open(temp,StandardOpenOption.WRITE)) {
                var bytes=ByteBuffer.wrap(value.toString().getBytes(StandardCharsets.UTF_8));
                while(bytes.hasRemaining()) out.write(bytes);
                out.force(true);
            }
            if (replace) Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            else Files.createLink(file,temp);
        } finally {Files.deleteIfExists(temp);}
    }
    static String text(JsonObject json,String key) {
        JsonElement value=json.get(key);
        if (value==null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException();
        return value.getAsString();
    }
    static UUID uuid(JsonObject json,String key) {
        String value=text(json,key);
        var id=UUID.fromString(value);
        if (!id.toString().equals(value)) throw new IllegalArgumentException();
        return id;
    }
    static String hash(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }
}
