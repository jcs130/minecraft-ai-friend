package org.afuhome.agentfriend;

import com.google.gson.*;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import java.nio.file.*;
import org.bukkit.configuration.file.YamlConfiguration;
import java.util.*;
import org.bukkit.entity.Player;

/** Small, private observations for Agents. Queries never dispatch gameplay actions.
 * Authentication is informational, supplied only by the proxy's local heartbeat file;
 * missing/expired data is unknown and is never used to grant permissions. */
final class AgentCommunication {
    static final String GUIDE_VERSION = "2026-10-23.9";
    static final long SNAPSHOT_TTL = 300_000L, AUTH_TTL = 15_000L;
    private static final class Session {
        final String id = UUID.randomUUID().toString(); final long joinedAt=System.currentTimeMillis();long sequence;
        final LinkedHashMap<String, Snapshot> snapshots = new LinkedHashMap<>();
    }
    private record Snapshot(String id, long at, String kind, String query, int total, List<AgentReplyPages.Page> pages) { }
    private final AgentFriendPlugin plugin;
    private final AgentMessageTransport transport;
    private final Map<UUID, Session> sessions = new HashMap<>();
    private final Path authFile;
    private JsonObject authHeartbeat;private long authReadAt;
    AgentCommunication(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        String path=YamlConfiguration.loadConfiguration(new java.io.File(plugin.getDataFolder(),"agent-guide.yml")).getString("auth-observation-file","");
        Path configured=null;
        try{if(!path.isBlank())configured=Path.of(path);}catch(InvalidPathException invalid){plugin.getLogger().warning("Invalid auth observation file path; authentication observations remain unknown.");}
        authFile=configured;
        transport=new AgentMessageTransport(plugin);
    }
    // Local, operator-configured file: no client chat or plugin-message claim is trusted.
    // One bounded read per second across all players. The proxy replaces it atomically.
    private JsonObject authentication(Player p) {
        long now=System.currentTimeMillis();
        if(authFile!=null&&now-authReadAt>=1000) {
            authReadAt=now;authHeartbeat=null;
            try{if(Files.size(authFile)<=1_048_576)authHeartbeat=JsonParser.parseString(Files.readString(authFile)).getAsJsonObject();}
            catch(java.io.IOException|RuntimeException unavailable){/* Unknown, never an inferred failed login. */}
        }
        JsonObject current=AgentAuthObservation.current(authHeartbeat,p.getUniqueId(),session(p).joinedAt,now);
        if(current!=null)return current;
        JsonObject unknown=new JsonObject();unknown.addProperty("status","unknown");unknown.add("authorized",JsonNull.INSTANCE);
        unknown.addProperty("reason","认证代理尚未提供本连接的新鲜观测；不能据此判断未登录");unknown.addProperty("queryCommand","/authstatus");return unknown;
    }
    private Session session(Player p) { return sessions.computeIfAbsent(p.getUniqueId(), ignored -> new Session()); }
    void joined(Player p) { sessions.put(p.getUniqueId(), new Session()); transport.joined(p); }
    void forget(Player p) { sessions.remove(p.getUniqueId()); transport.forget(p); }
    boolean compact(Player p) { return p.getName().toLowerCase(Locale.ROOT).startsWith("ag_") || plugin.isRegisteredAgent(p); }
    JsonObject envelope(Player p, String kind) {
        Session session = session(p); JsonObject out = new JsonObject();
        out.addProperty("schemaVersion", 1); out.addProperty("kind", kind); out.addProperty("scope", "self");
        out.addProperty("playerUuid", p.getUniqueId().toString()); out.addProperty("sessionId", session.id);
        out.addProperty("sequence", ++session.sequence); out.addProperty("observedAt", System.currentTimeMillis());
        out.addProperty("readOnly", true); return out;
    }
    void stamp(Player p, JsonObject out) {
        JsonObject context = envelope(p, "observation");
        for (String key : List.of("sessionId", "sequence", "observedAt")) out.add(key, context.get(key));
    }
    private void send(Player p, String prefix, JsonObject out) { p.sendMessage(prefix + " " + out); }
    void welcome(Player p) {
        JsonObject out = envelope(p, "guidance"); out.addProperty("guideVersion", GUIDE_VERSION);
        out.addProperty("stableGuidance", true); out.addProperty("language", "zh-CN");
        out.addProperty("message", "先查status，按需用<命令> --help学习用法。动作后核对真实结果；超时或断线结果未知，先查询，勿自动重放。");
        out.addProperty("helpCommand", "/mycli --help");
        out.addProperty("stateCommand", "/mycli status"); out.addProperty("tasksCommand", "/mycli progress all 1");
        out.addProperty("skillCommand", "/mycli skills status <ID>"); out.addProperty("skillsCommand", "/mycli skills status");
        out.addProperty("rulesCommand", "/mycli rules"); out.addProperty("capabilitiesCommand", "/mycli capabilities");
        out.addProperty("detailCommand", "/mycli coach guide"); out.addProperty("authCommand", "/authstatus");
        out.addProperty("backpackCommand","/minepacks:backpack open");
        out.addProperty("storyCommand","/mycli world story status");
        out.addProperty("backpackAdvice","54格个人大背包可普通存取，独立于任务袋和奖励箱。等待服务端槽位与光标确认，关闭重开核对；超时先查询，不自动重放。");
        send(p, "MC_GUIDE", out); state(p,true);
    }
    void state(Player p) {
        state(p,false);
    }
    void state(Player p,boolean jsonOnly) {
        JsonObject out = envelope(p, "state"); out.addProperty("name", p.getName()); out.addProperty("mode", p.getGameMode().name());
        out.addProperty("health", p.getHealth()); out.addProperty("maxHealth",p.getMaxHealth());out.addProperty("food", p.getFoodLevel());
        out.addProperty("adventurerRank",plugin.guild().adventurerRankName(p));out.add("profession",plugin.professions().readProfession(p));
        if (plugin.combatRpg() != null) out.add("combatRpg",plugin.combatRpg().state(p));
        var user = AuraSkillsApi.get().getUser(p.getUniqueId()); boolean manaKnown = user != null && user.isLoaded();
        out.add("mana", manaKnown ? new JsonPrimitive(user.getMana()) : JsonNull.INSTANCE);
        out.add("maxMana", manaKnown ? new JsonPrimitive(user.getMaxMana()) : JsonNull.INSTANCE);
        out.addProperty("manaStatus", manaKnown ? "known" : "unknown_not_loaded");
        out.add("authentication", authentication(p));
        JsonObject next = plugin.agentCoach().entryState(p);
        if (next.has("step")) {
            out.add("mainStage", next.get("step")); out.add("mainlineGraduated", next.get("completed"));
            out.add("nextCommand", next.get("nextCommand"));
        } else { out.addProperty("mainStage", "observer"); out.addProperty("nextCommand", "/mycli intro"); }
        out.addProperty("progressCommand", "/mycli progress all 1");
        out.addProperty("routesCommand", "/mycli tasks list");
        out.addProperty("storyCommand", "/mycli world story status");
        out.addProperty("skillsCommand", "/mycli skills status"); out.addProperty("inventoryCommand", "/mycli inventory status");
        out.addProperty("fullCommand", "/mycli status full");
        out.addProperty("downed", plugin.isDowned(p)); out.addProperty("inDungeon", plugin.dungeonParticipant(p));
        out.addProperty("inPvp", plugin.pvpParticipant(p));
        JsonObject challenge=plugin.lifeChallenges().activeSummary(p);if(challenge!=null)out.add("challenge",challenge);
        if(!jsonOnly) AgentCliText.state(out).forEach(p::sendMessage);
        if(jsonOnly)send(p, "MC_STATUS", out);
    }
    void reminder(Player p, JsonObject state, String type) {
        p.sendMessage("§b[提示] " + state.get("title").getAsString() + "。命令：" + state.get("nextCommand").getAsString());
    }
    String store(Player p, String kind, String query, List<JsonObject> rows) {
        Session session = session(p); long now = System.currentTimeMillis();
        session.snapshots.values().removeIf(snapshot -> now - snapshot.at() > SNAPSHOT_TTL);
        String id = UUID.randomUUID().toString(); Snapshot snapshot = new Snapshot(id, now, kind, query, rows.size(), AgentReplyPages.pack(rows));
        while (session.snapshots.size() >= 2) session.snapshots.remove(session.snapshots.keySet().iterator().next());
        session.snapshots.put(id, snapshot); return id;
    }
    void page(Player p, String id, int page) {
        Snapshot snapshot = session(p).snapshots.get(id);
        if (snapshot == null || System.currentTimeMillis() - snapshot.at() > SNAPSHOT_TTL) {
            error(p, "SNAPSHOT_EXPIRED", "详情快照已过期、被新查询替换或属于其他连接；重新读取当前状态。", true, snapshot == null ? "/mycli status" : snapshot.query()); return;
        }
        if (page < 1 || page > snapshot.pages().size()) {
            error(p, "INVALID_PAGE", "页码范围为1至" + snapshot.pages().size(), false, "/mycli page " + id + " 1"); return;
        }
        JsonObject out = envelope(p, snapshot.kind()); out.addProperty("snapshotId", id); out.addProperty("snapshotObservedAt", snapshot.at());
        out.addProperty("page", page); out.addProperty("pages", snapshot.pages().size()); out.addProperty("total", snapshot.total());
        out.addProperty("firstItem", snapshot.pages().get(page - 1).firstItem()); out.addProperty("lastItem", snapshot.pages().get(page - 1).lastItem());
        out.addProperty("expiresAt", snapshot.at() + SNAPSHOT_TTL); out.addProperty("refreshCommand", snapshot.query());
        out.add("items", snapshot.pages().get(page - 1).items().deepCopy());
        if (page < snapshot.pages().size()) out.addProperty("nextCommand", "/mycli page " + id + " " + (page + 1));
        send(p, "MC_PAGE", out);
    }
    void list(Player p, String kind, String query, List<JsonObject> rows, int page) {
        try { page(p, store(p, kind, query, rows), page); }
        catch (IllegalArgumentException tooLarge) { error(p, "RESPONSE_TOO_LARGE", "结果超过单次快照上限；按主线、专项、公会或技能ID缩小查询。内容未被截断。", false, "/mycli progress main 1"); }
    }
    void error(Player p, String code, String reason, boolean retryable, String nextCommand) {
        JsonObject out = envelope(p, "error"); out.addProperty("errorCode", code); out.addProperty("reason", reason);
        out.addProperty("retryable", retryable); out.addProperty("retryPolicy", "先执行nextCommand核对，再决定；不自动重放动作");
        out.addProperty("nextCommand", nextCommand); send(p, "MC_QUERY_ERROR", out);
    }
    void pageCommand(Player p, String[] args) {
        try {
            if (args.length < 2 || args.length > 3) throw new IllegalArgumentException();
            UUID.fromString(args[1]); page(p, args[1], args.length == 3 ? Integer.parseInt(args[2]) : 1);
        } catch (IllegalArgumentException invalid) {
            error(p, "INVALID_ARGUMENT", "格式：/mycli page <快照ID> [页码]。从上一次查询的nextCommand复制续读命令。", false, "/mycli status");
        }
    }
    void skills(Player p, String[] args) {
        skills(p,args,false);
    }
    void skills(Player p, String[] args, boolean jsonOnly) {
        try {
            if (args.length > 4) throw new IllegalArgumentException();
            String filter = args.length > 2 ? args[2].toLowerCase(Locale.ROOT) : "mine";
            List<JsonObject> rows = new ArrayList<>();
            if (Set.of("mine", "all").contains(filter)) {
                for (SpellGuide.Entry entry : SpellGuide.entries()) {
                    JsonObject row = plugin.professions().readSkillState(p, entry.id());
                    // Unknown learning data must not look like an empty list of learned skills.
                    if (filter.equals("all") || row.get("learned").isJsonNull() || row.get("learned").getAsBoolean()) rows.add(row);
                }
            } else {
                SpellGuide.Entry entry = SpellGuide.find(filter);
                if (entry == null) { error(p, "UNKNOWN_SKILL", "该技能ID不存在；从实际技能目录复制ID。", false, "/mycli skills list"); return; }
                filter = entry.id(); rows.add(plugin.professions().readSkillState(p, filter));
            }
            int page=args.length > 3 ? Integer.parseInt(args[3]) : 1;
            if(jsonOnly)list(p, "skills", "/mycli skills status " + filter + " 1", rows, page);
            else AgentCliText.skills(rows,filter,page).forEach(p::sendMessage);
        } catch (IllegalArgumentException invalid) {
            error(p, "INVALID_ARGUMENT", "格式：/mycli skills status [mine|all|技能ID] [页码]。只读，不学习、不刷新点数。", false, "/mycli skills status");
        }
    }
    void jsonCommand(Player p,String[] raw) {
        if (raw.length == 3 && raw[0].equalsIgnoreCase("world") && raw[1].equalsIgnoreCase("board")) { plugin.worldLife().command(p, raw); return; }
        if (raw.length == 3 && raw[0].equalsIgnoreCase("coach") && Set.of("next", "guide").contains(raw[1])) { plugin.agentCoach().command(p, raw); return; }
        if(raw.length>=2&&raw[0].equalsIgnoreCase("world")&&raw[1].equalsIgnoreCase("story")){plugin.worldLife().command(p,raw);return;}
        String[] args=Arrays.stream(raw).filter(s->!s.equals("--json")).toArray(String[]::new);
        String root=args.length==0?"status":args[0].toLowerCase(Locale.ROOT);
        if(root.equals("archive")){
            String[] query=Arrays.copyOf(args,args.length+1);query[args.length]="--json";
            plugin.archives().command(p,query);return;
        }
        if(root.equals("protect")||root.equals("保护")) {
            String[] query=Arrays.copyOf(args,args.length+1);query[args.length]="--json";
            plugin.protectionAdvisor().command(p,query);return;
        }
        if(root.equals("status")&&args.length<=1) {state(p,true);return;}
        if(root.equals("progress")&&args.length<=3) {
            plugin.agentEntry().progress(p,args.length==1?new String[]{"progress","all","1"}:args.length==2?new String[]{"progress",args[1],"1"}:args,true);return;
        }
        if(root.equals("skills")&&args.length>1&&args[1].equalsIgnoreCase("status")) {skills(p,args,true);return;}
        if(root.equals("page")) {pageCommand(p,args);return;}
        if(root.equals("intro")) {plugin.agentEntry().intro(p,true);return;}
        if(root.equals("rules")) {plugin.agentEntry().rules(p,args,true);return;}
        if(root.equals("capabilities")) {plugin.agentEntry().capabilities(p,args);return;}
        if(root.equals("challenge")) {plugin.lifeChallenges().jsonCommand(p,args);return;}
        if(root.equals("tasks")) {
            String[] query=Arrays.copyOf(args,args.length+1);query[args.length]="--json";
            plugin.taskMarket().routes().command(p,query);return;
        }
        if(root.equals("guild")&&args.length>=3&&args[1].equalsIgnoreCase("exam")
                &&Set.of("status","info","guide","supplies").contains(args[2].toLowerCase(Locale.ROOT))) {
            plugin.skillAssessments().jsonQuery(p,args);return;
        }
        error(p,"UNSUPPORTED_FORMAT","该旧入口尚未提供--json格式，本次未执行。用命令的--help核对支持情况；已有原回执入口保持兼容。",false,"/mycli "+root+" --help --json");
    }
}
