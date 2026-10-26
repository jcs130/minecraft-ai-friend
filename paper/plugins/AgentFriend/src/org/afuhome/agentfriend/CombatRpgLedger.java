package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Owned by one I/O worker. Publish the new immutable snapshot only after fsync
 * and atomic replacement. Never share AgentFriend's frequently saved config.yml. */
final class CombatRpgLedger {
    record Award(UUID event, List<CombatRpgRules.Credit> credits) {
        Award { Objects.requireNonNull(event); credits=List.copyOf(credits);
            if(credits.isEmpty()||credits.size()>40||credits.stream().map(CombatRpgRules.Credit::id).distinct().count()!=credits.size())
                throw new IllegalArgumentException("credits"); }
    }
    record PlayerRecord(UUID id,String name,long xp,long kills,int highestFloor,Set<Integer> cleared) {
        PlayerRecord {cleared=Set.copyOf(cleared);}
        CombatRpgRules.Progress progress(){return CombatRpgRules.progress(xp);}
    }
    record Snapshot(Map<UUID,PlayerRecord> players,Set<UUID> receipts) {
        Snapshot {players=Map.copyOf(players);receipts=Collections.unmodifiableSet(new LinkedHashSet<>(receipts));}
        PlayerRecord player(UUID id,String name){return players.getOrDefault(id,new PlayerRecord(id,name,0,0,0,Set.of()));}
        List<PlayerRecord> ranking(){return players.values().stream()
                .sorted(Comparator.comparingInt(PlayerRecord::highestFloor).reversed()
                .thenComparing(Comparator.comparingLong(PlayerRecord::xp).reversed())
                .thenComparing(p->p.id.toString())).limit(10).toList();}
    }
    interface Writer {void write(Path file,byte[] bytes)throws Exception;}
    private final Path file;
    private final Writer writer;
    private volatile Snapshot current;
    CombatRpgLedger(Path file)throws Exception {this(file,CombatRpgLedger::atomic);}
    CombatRpgLedger(Path file,Writer writer)throws Exception {
        this.file=file;this.writer=writer;
        if(Files.exists(file)&&Files.size(file)>16_777_216)throw new IllegalArgumentException("ledger_capacity");
        current=Files.exists(file)?decode(Files.readAllBytes(file)):new Snapshot(Map.of(),Set.of());
    }
    Snapshot snapshot(){return current;}
    synchronized Snapshot apply(List<Award> awards)throws Exception {
        if(awards.isEmpty())return current;
        var players=new HashMap<>(current.players);var receipts=new LinkedHashSet<>(current.receipts);
        boolean changed=false;
        for(Award award:awards){
            if(!receipts.add(award.event))continue;
            changed=true;
            for(var credit:award.credits){
                var prior=players.getOrDefault(credit.id(),new PlayerRecord(credit.id(),credit.name(),0,0,0,Set.of()));
                // Floor unlock and its XP are once per character, permanently.
                // This survives eviction of bounded generic mob receipts.
                if(credit.floor()>0&&prior.cleared.contains(credit.floor()))continue;
                var cleared=new HashSet<>(prior.cleared);
                // Only a settled formal encounter can provide floor > 0. Practice
                // and generic mob kills are always 0, irrespective of display name.
                if(credit.floor()>0)cleared.add(credit.floor());
                int contiguous=0;while(cleared.contains(contiguous+1))contiguous++;
                players.put(credit.id(),new PlayerRecord(credit.id(),credit.name(),
                        Math.min(CombatRpgRules.MAX_XP,prior.xp+credit.xp()),
                        Math.min(1_000_000_000L,prior.kills+credit.kills()),contiguous,cleared));
            }
        }
        if(!changed)return current;
        if(players.size()>20_000)throw new IllegalStateException("player_capacity");
        // Death events originate only on the server. Dead entity UUIDs cannot be
        // resubmitted by a client. Keep recent receipts across cold restarts.
        while(receipts.size()>32_768)receipts.remove(receipts.iterator().next());
        var next=new Snapshot(players,receipts);
        writer.write(file,encode(next));current=next;return next;
    }
    static byte[] encode(Snapshot state){
        var root=new JsonObject();root.addProperty("schemaVersion",1);var players=new JsonObject();
        for(var p:state.players.values().stream().sorted(Comparator.comparing(v->v.id.toString())).toList()){
            var row=new JsonObject();row.addProperty("name",p.name);row.addProperty("xp",p.xp);row.addProperty("kills",p.kills);
            row.addProperty("highestFloor",p.highestFloor);var floors=new JsonArray();p.cleared.stream().sorted().forEach(floors::add);row.add("cleared",floors);players.add(p.id.toString(),row);
        }
        root.add("players",players);var events=new JsonArray();state.receipts.forEach(e->events.add(e.toString()));root.add("receipts",events);
        byte[] bytes=root.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>16_777_216)throw new IllegalStateException("ledger_capacity");return bytes;
    }
    static Snapshot decode(byte[] bytes){
        if(bytes.length>16_777_216)throw new IllegalArgumentException("ledger_capacity");
        var root=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
        if(root.get("schemaVersion").getAsInt()!=1)throw new IllegalArgumentException("schema");
        var players=new HashMap<UUID,PlayerRecord>();
        for(var e:root.getAsJsonObject("players").entrySet()){
            UUID id=UUID.fromString(e.getKey());var row=e.getValue().getAsJsonObject();String name=row.get("name").getAsString();
            new CombatRpgRules.Fighter(id,name,0,0,0,true,true);
            long xp=integer(row.get("xp"),CombatRpgRules.MAX_XP),kills=integer(row.get("kills"),1_000_000_000L);
            var cleared=new HashSet<Integer>();for(var f:row.getAsJsonArray("cleared")){
                int floor=(int)integer(f,100);if(floor==0||!cleared.add(floor))throw new IllegalArgumentException("floor");}
            int contiguous=0;while(cleared.contains(contiguous+1))contiguous++;
            if(integer(row.get("highestFloor"),100)!=contiguous)throw new IllegalArgumentException("floor_gap");
            players.put(id,new PlayerRecord(id,name,xp,kills,contiguous,cleared));
        }
        var receipts=new LinkedHashSet<UUID>();for(var e:root.getAsJsonArray("receipts"))if(!receipts.add(UUID.fromString(e.getAsString())))throw new IllegalArgumentException("duplicate receipt");
        if(players.size()>20_000||receipts.size()>32_768)throw new IllegalArgumentException("capacity");return new Snapshot(players,receipts);
    }
    private static long integer(JsonElement e,long max){
        if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("number");
        try{long value=e.getAsBigDecimal().longValueExact();if(value<0||value>max)throw new IllegalArgumentException("bounds");return value;}
        catch(ArithmeticException invalid){throw new IllegalArgumentException("integer",invalid);}
    }
    static void atomic(Path file,byte[] bytes)throws Exception {
        Files.createDirectories(file.toAbsolutePath().getParent());Path temp=file.resolveSibling(file.getFileName()+".tmp");
        try{try(var channel=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){
            ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())channel.write(buffer);channel.force(true);}
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }finally{Files.deleteIfExists(temp);}
    }
}
