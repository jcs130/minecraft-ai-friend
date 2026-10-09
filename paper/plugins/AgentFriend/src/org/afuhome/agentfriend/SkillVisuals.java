package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.ProtocolManager;
import com.comphenix.protocol.events.PacketContainer;
import java.io.File;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.craftbukkit.CraftParticle;
import net.minecraft.network.protocol.game.ClientboundLevelParticlesPacket;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.util.Vector;

/** Cosmetic only. One main-thread renderer, bounded recipients/points, no entities or chunk loads. */
final class SkillVisuals {
    private static final Set<String> SHAPES = Set.of("ring", "helix", "lotus", "star", "snowflake",
            "fan", "wings", "crescent", "shield", "diamond", "cube", "beam", "eyes", "points");
    private static final Set<String> PARTICLES = Set.of("DUST", "DUST_COLOR_TRANSITION", "END_ROD",
            "CLOUD", "FLAME", "SOUL_FIRE_FLAME", "SNOWFLAKE", "HEART", "CRIT", "ELECTRIC_SPARK", "PORTAL", "ENCHANT");
    private final AgentFriendPlugin plugin;
    private final ProtocolManager protocol;
    private final List<Animation> active = new ArrayList<>();
    private Map<String, Profile> profiles = Map.of();
    private Limits limits = new Limits(true, 24, 12, 32, 2, 256, 64);
    private BukkitTask task;
    private long admitted, dropped, packets, throttled, frames, errors;
    private int cursor, peakTickPackets, lastTickPackets;
    private record Limits(boolean enabled, int range, int viewers, int active, int perCaster, int packets, int perViewer) { }
    private record Point(double x, double y, double z) { }
    private record Layer(String shape, Particle particle, int count, double radius, double height,
                         double lift, double spin, double expand, float size, Color from, Color to,
                         double phase, List<Point> points) { }
    private record Profile(String name, String anchor, int duration, int interval, List<Layer> layers) { }
    private record Animation(UUID caster, World world, Location origin, Location destination,
                             Vector facing, Profile profile, int born, int rank, boolean follow) { }

    SkillVisuals(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        this.protocol = ProtocolLibrary.getProtocolManager();
        File file = new File(plugin.getDataFolder(), "skill-visuals.yml");
        if (!file.exists()) plugin.saveResource("skill-visuals.yml", false);
        if (!reload()) {
            try { load(YamlConfiguration.loadConfiguration(new java.io.InputStreamReader(
                    Objects.requireNonNull(plugin.getResource("skill-visuals.yml")), java.nio.charset.StandardCharsets.UTF_8))); }
            catch (RuntimeException bad) { plugin.getLogger().severe("Default skill visuals unavailable: " + bad.getMessage()); }
        }
        task = Bukkit.getScheduler().runTaskTimer(plugin, ()->{
            try { tick(); } catch (RuntimeException bad) {
                active.clear(); errors++; plugin.getLogger().warning("Cosmetic rendering stopped current animations: "+bad);
            }
        }, 1, 1);
    }
    void stop() { if (task != null) task.cancel(); active.clear(); }
    private boolean reload() {
        try {
            File file = new File(plugin.getDataFolder(), "skill-visuals.yml");
            if (file.length() > 262_144) throw new IllegalArgumentException("配置超过256 KiB");
            YamlConfiguration config = new YamlConfiguration(); config.load(file); load(config);
            return true;
        } catch (Exception bad) {
            plugin.getLogger().warning("Skill visuals reload rejected; keeping last good configuration: " + bad.getMessage());
            return false;
        }
    }
    private static int integer(ConfigurationSection c, String key, int def, int min, int max) {
        Object raw=c.get(key,def); if(!(raw instanceof Number)) throw new IllegalArgumentException(key+"须为数字");
        double n = ((Number)raw).doubleValue();
        if (!Double.isFinite(n) || n != Math.rint(n) || n < min || n > max) throw new IllegalArgumentException(key + "须在" + min + ".." + max);
        return (int)n;
    }
    private static double number(ConfigurationSection c, String key, double def, double min, double max) {
        Object raw=c.get(key,def); if(!(raw instanceof Number)) throw new IllegalArgumentException(key+"须为数字");
        double n = ((Number)raw).doubleValue();
        if (!Double.isFinite(n) || n < min || n > max) throw new IllegalArgumentException(key + "超范围");
        return n;
    }
    private static Color color(String s) {
        if (s == null || !s.matches("#[0-9a-fA-F]{6}")) throw new IllegalArgumentException("颜色须为#RRGGBB");
        return Color.fromRGB(Integer.parseInt(s.substring(1), 16));
    }
    private void load(YamlConfiguration c) {
        if (c.getInt("schema-version") != 1) throw new IllegalArgumentException("schema-version须为1");
        ConfigurationSection b = Objects.requireNonNull(c.getConfigurationSection("budget"), "缺少budget");
        Limits next = new Limits(c.getBoolean("enabled", true), integer(b,"view-distance",24,8,32),
                integer(b,"max-viewers",12,1,16), integer(b,"max-active",32,1,48), integer(b,"max-per-caster",2,1,3),
                integer(b,"packets-per-tick",256,16,512), integer(b,"packets-per-viewer-tick",64,8,96));
        ConfigurationSection effects = Objects.requireNonNull(c.getConfigurationSection("effects"), "缺少effects");
        if (effects.getKeys(false).isEmpty() || effects.getKeys(false).size() > 64) throw new IllegalArgumentException("effects须有1..64项");
        Map<String, Profile> parsed = new LinkedHashMap<>();
        for (String name : effects.getKeys(false)) {
            ConfigurationSection e = Objects.requireNonNull(effects.getConfigurationSection(name), name);
            String anchor = e.getString("anchor", "caster");
            if (!Set.of("caster","target","beam").contains(anchor)) throw new IllegalArgumentException(name + ": anchor无效");
            int duration = integer(e,"duration-ticks",24,6,48), interval = integer(e,"interval-ticks",3,2,8);
            if ((duration + interval - 1) / interval > 16) throw new IllegalArgumentException(name + ": 最多16帧");
            List<Layer> layers = new ArrayList<>(); int total = 0;
            List<Map<?,?>> rawLayers = e.getMapList("layers");
            if (rawLayers.isEmpty() || rawLayers.size() > 3) throw new IllegalArgumentException(name + ": 图层须有1..3项");
            for (Map<?,?> raw : rawLayers) {
                YamlConfiguration l = new YamlConfiguration(); raw.forEach((k,v)->l.set(k.toString(),v));
                String shape = l.getString("shape","ring"), particle = l.getString("particle","DUST");
                if (!SHAPES.contains(shape) || !PARTICLES.contains(particle)) throw new IllegalArgumentException(name + ": 形状或粒子不支持1.20.6");
                List<Point> points = new ArrayList<>();
                if (shape.equals("points")) {
                    for (Object value : l.getList("points", List.of())) {
                        if (!(value instanceof List<?> p) || p.size() != 3) throw new IllegalArgumentException(name + ": 点须为[x,y,z]");
                        double[] xyz = new double[3];
                        for (int i=0;i<3;i++) {
                            if (!(p.get(i) instanceof Number n) || !Double.isFinite(n.doubleValue()) || Math.abs(n.doubleValue()) > 8)
                                throw new IllegalArgumentException(name + ": 点坐标须在-8..8格");
                            xyz[i]=n.doubleValue();
                        }
                        points.add(new Point(xyz[0],xyz[1],xyz[2]));
                    }
                    if (points.isEmpty() || points.size()>48) throw new IllegalArgumentException(name + ": 每层1..48个点");
                }
                int count = shape.equals("points") ? points.size() : integer(l,"count",20,4,48); total += count;
                layers.add(new Layer(shape, Particle.valueOf(particle), count, number(l,"radius",1,0.1,6),
                        number(l,"height",1,0,4),number(l,"lift",0.15,-1,4),number(l,"spin",0.2,-2,2),
                        number(l,"expand",0.2,-0.8,2), (float)number(l,"size",0.8,0.3,1.5),
                        color(l.getString("color","#7CE8FF")),color(l.getString("color-end","#FFFFFF")),
                        number(l,"phase",0,-Math.PI*2,Math.PI*2),List.copyOf(points)));
            }
            if (total > 64) throw new IllegalArgumentException(name + ": 每帧最多64点");
            Profile p = new Profile(name,anchor,duration,interval,List.copyOf(layers));
            List<String> skills = e.getStringList("skills");
            if (skills.isEmpty()) throw new IllegalArgumentException(name + ": 缺少skills");
            for (String id : skills) if (!id.matches("[a-z_]{2,32}") || parsed.putIfAbsent(id,p) != null)
                throw new IllegalArgumentException(name + ": 重复或无效技能ID " + id);
        }
        // Publish only after the complete candidate has passed validation. In-flight animations use their snapshots.
        limits = next; profiles = Map.copyOf(parsed);
        if (!next.enabled) active.clear();
    }
    private static String normalize(String id) { return id.startsWith("conjure_") || id.equals("give") ? "conjure" : id; }
    boolean play(Player caster, String id, Location target) {
        Profile profile = profiles.get(normalize(id));
        if (!limits.enabled || profile == null || caster == null || !caster.isOnline() || caster.isDead()
                || target == null || target.getWorld() != caster.getWorld()) return false;
        if (active.size() >= limits.active || active.stream().filter(a->a.caster.equals(caster.getUniqueId())).count() >= limits.perCaster) { dropped++; return false; }
        Location origin = caster.getLocation().clone(), destination = target.clone();
        if (!finite(destination) || origin.distanceSquared(destination)>64*64) return false;
        int rank = 1;
        if (plugin.professions().skill(id) != null) rank = Math.max(1,plugin.professions().level(caster,id));
        else if (SpellMastery.NAMES.containsKey(id)) rank = plugin.mastery().rank(caster,id);
        active.add(new Animation(caster.getUniqueId(),caster.getWorld(),origin,destination,
                caster.getEyeLocation().getDirection().clone(), profile, Bukkit.getCurrentTick(),rank, profile.anchor.equals("caster")));
        admitted++; return true;
    }
    private static boolean finite(Location at) { return Double.isFinite(at.getX())&&Double.isFinite(at.getY())&&Double.isFinite(at.getZ()); }
    private void tick() {
        int now = Bukkit.getCurrentTick();
        active.removeIf(a->{Player p=Bukkit.getPlayer(a.caster); return now-a.born>=a.profile.duration || p==null||!p.isOnline()||p.isDead()||p.getWorld()!=a.world;});
        lastTickPackets=0;
        if (active.isEmpty()) return;
        int budget = limits.packets;
        if (Bukkit.getAverageTickTime()>45) budget=Math.max(16,budget/2);
        Map<UUID,Integer> used = new HashMap<>(); List<Player> online = new ArrayList<>(Bukkit.getOnlinePlayers());
        int size=active.size(), start=Math.floorMod(cursor++,size);
        for (int k=0;k<size;k++) {
            Animation a=active.get((start+k)%size); int age=now-a.born;
            if (age%a.profile.interval!=0) continue;
            Player caster=Bukkit.getPlayer(a.caster); if(caster==null) continue;
            Location center=a.follow?caster.getLocation():a.profile.anchor.equals("target")?a.destination:a.origin;
            List<Player> viewers=online.stream().filter(p->p.getWorld()==a.world&&p.canSee(caster)
                    &&p.getLocation().distanceSquared(center)<=limits.range*limits.range)
                    .sorted(Comparator.<Player>comparingInt(p->p==caster?0:p.getGameMode()==GameMode.SPECTATOR
                            &&p.getSpectatorTarget()==caster?1:2).thenComparingDouble(p->p.getLocation().distanceSquared(center)))
                    .limit(limits.viewers).toList();
            double progress=age/(double)a.profile.duration, seconds=age/20.0;
            frames++;
            for (Layer layer:a.profile.layers) {
                Object data = layer.particle==Particle.DUST?new Particle.DustOptions(blend(layer.from,layer.to,progress),layer.size)
                        :layer.particle==Particle.DUST_COLOR_TRANSITION?new Particle.DustTransition(layer.from,layer.to,layer.size):null;
                for (int i=0;i<layer.count;i++) {
                    Point local=point(layer,i,seconds,progress,a.rank);
                    Location at=position(a,center,layer,local,i,progress);
                    if (!finite(at)||!a.world.isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)) continue;
                    PacketContainer packet=null;
                    for(Player viewer:viewers) {
                        if(viewer.getLocation().distanceSquared(at)>limits.range*limits.range) continue;
                        int count=used.getOrDefault(viewer.getUniqueId(),0);
                        if(lastTickPackets>=budget||count>=limits.perViewer) {throttled++;continue;}
                        if(packet==null) packet=PacketContainer.fromPacket(new ClientboundLevelParticlesPacket(
                                CraftParticle.createParticleParam(layer.particle,data),false,at.getX(),at.getY(),at.getZ(),0,0,0,0,1));
                        // Every nearby connection, including an actual attached Eye, gets one copy.
                        // Bypass the old particle mirroring listeners, retaining accurate delivery budgets.
                        protocol.sendServerPacket(viewer,packet,false);
                        used.put(viewer.getUniqueId(),count+1);lastTickPackets++;packets++;
                    }
                }
            }
        }
        peakTickPackets=Math.max(peakTickPackets,lastTickPackets);
    }
    private static Color blend(Color a,Color b,double t) { return Color.fromRGB((int)(a.getRed()+(b.getRed()-a.getRed())*t),
            (int)(a.getGreen()+(b.getGreen()-a.getGreen())*t),(int)(a.getBlue()+(b.getBlue()-a.getBlue())*t)); }
    private static Point point(Layer l,int i,double seconds,double p,int rank) {
        double t=i/(double)l.count, angle=2*Math.PI*t+l.phase+seconds*l.spin*2*Math.PI;
        double r=l.radius*(1+l.expand*p)*(1+0.06*(rank-1)), x=0,y=0,z=0;
        switch(l.shape) {
            case "points" -> {Point q=l.points.get(i);double s=1+l.expand*p;double a=seconds*l.spin*2*Math.PI;
                return new Point((q.x*Math.cos(a)-q.z*Math.sin(a))*s,q.y*s+l.lift,(q.x*Math.sin(a)+q.z*Math.cos(a))*s);}
            case "helix" -> {x=r*Math.cos(angle+4*Math.PI*t);z=r*Math.sin(angle+4*Math.PI*t);y=l.height*t;}
            case "lotus" -> {double d=r*(0.58+0.42*Math.cos(5*angle));x=d*Math.cos(angle);z=d*Math.sin(angle);y=l.height*0.15*Math.sin(angle*5);}
            case "star" -> {double d=r*(i%2==0?1:0.43);x=d*Math.cos(angle);z=d*Math.sin(angle);y=l.height*p*0.35;}
            case "snowflake" -> {int arm=i%6;double d=r*(.18+.82*(i/6)/(double)Math.max(1,(l.count-1)/6));double a=arm*Math.PI/3+l.phase;
                x=d*Math.cos(a);z=d*Math.sin(a);y=.08*Math.sin(seconds*2+i);}
            case "fan" -> {double a=(t-.5)*Math.PI*.85;double d=r*(.3+.7*p);x=Math.sin(a)*d;z=Math.cos(a)*d;y=l.height*(.3+.45*Math.sin(Math.PI*t));}
            case "wings" -> {int half=(l.count+1)/2;double u=(i%half)/(double)Math.max(1,half-1);x=(i<half?-1:1)*r*(.2+.8*u);
                z=-.25-.25*Math.sin(u*Math.PI);y=l.height*(.3+.7*Math.sin(Math.PI*u))+.15*Math.sin(seconds*4);}
            case "crescent" -> {double a=(t-.5)*Math.PI*1.4+l.phase; x=r*Math.sin(a);z=r*Math.cos(a);y=l.height*(.35+.3*Math.cos(a));}
            case "shield" -> {x=r*Math.cos(angle);y=l.height*(.5+.5*Math.sin(angle));z=.65;}
            case "diamond" -> {double a=t*4;int side=(int)a;double u=a-side;double[][] v={{0,1},{1,0},{0,-1},{-1,0},{0,1}};
                x=r*(v[side][0]*(1-u)+v[side+1][0]*u);y=l.height*.5+r*(v[side][1]*(1-u)+v[side+1][1]*u);z=.3;}
            case "cube" -> {int edge=i%12;double u=(i/12)/(double)Math.max(1,(l.count-1)/12);int axis=edge/4,sign=edge%4;
                double[] q={((sign&1)==0?-1:1)*r,((sign&2)==0?-1:1)*r,-r+2*r*u};
                if(axis==0){x=q[2];y=q[0]+r;z=q[1];}else if(axis==1){x=q[0];y=q[2]+r;z=q[1];}else{x=q[0];y=q[1]+r;z=q[2];}}
            case "beam" -> {x=.1*Math.cos(angle);y=.1*Math.sin(angle);z=t;}
            case "eyes" -> {int half=(l.count+1)/2;double a=2*Math.PI*(i%half)/half;x=(i<half?-.34:.34)+.25*Math.cos(a);y=1.6+.12*Math.sin(a);z=.5;}
            default -> {x=r*Math.cos(angle);z=r*Math.sin(angle);y=l.height*.1*Math.sin(angle*2);}
        }
        return new Point(x,y+l.lift,z);
    }
    private static Location position(Animation a,Location center,Layer l,Point q,int i,double progress) {
        if (l.shape.equals("beam")) {
            Location start=a.origin.clone().add(0,1.5,0);Vector line=a.destination.toVector().subtract(start.toVector());
            if(line.lengthSquared()<1)line=a.facing.clone().multiply(Math.min(8,l.radius*3));
            return start.add(line.multiply(q.z)).add(q.x,q.y-l.lift,0);
        }
        double yaw=Math.toRadians(a.origin.getYaw());
        return center.clone().add(q.x*Math.cos(yaw)-q.z*Math.sin(yaw),q.y,q.x*Math.sin(yaw)+q.z*Math.cos(yaw));
    }
    void audit(CommandSender sender) {
        JsonObject o=new JsonObject();o.addProperty("schemaVersion",1);o.addProperty("enabled",limits.enabled);
        o.addProperty("skills",profiles.size());o.addProperty("profiles",profiles.values().stream().distinct().count());
        o.addProperty("active",active.size());o.addProperty("admitted",admitted);o.addProperty("dropped",dropped);
        o.addProperty("packets",packets);o.addProperty("throttled",throttled);o.addProperty("frames",frames);o.addProperty("errors",errors);
        o.addProperty("lastTickPackets",lastTickPackets);o.addProperty("peakTickPackets",peakTickPackets);
        o.addProperty("packetsPerTick",limits.packets);o.addProperty("packetsPerViewerTick",limits.perViewer);
        o.addProperty("viewDistance",limits.range);o.addProperty("maxActive",limits.active);o.addProperty("maxPerCaster",limits.perCaster);
        o.addProperty("vanillaPackets",true);o.addProperty("gameplayChanged",false);
        sender.sendMessage("MC_VISUALS "+o);
    }
    void admin(CommandSender sender,String[] args) {
        if(args.length==3&&args[2].equalsIgnoreCase("reload")) {
            sender.sendMessage("MC_VISUALS_RELOAD status="+(reload()?"success":"rejected")+" next=编辑skill-visuals.yml修正后再次reload；失败保留上一份可用配置");return;
        }
        if(args.length==5&&args[2].equalsIgnoreCase("preview")) {
            Player target=Bukkit.getPlayerExact(args[3]);String id=normalize(args[4]);
            if(target==null||!profiles.containsKey(id)){sender.sendMessage("MC_VISUALS_PREVIEW status=rejected next=使用在线玩家名和已配置技能ID");return;}
            boolean queued=play(target,id,target.getLocation());sender.sendMessage("MC_VISUALS_PREVIEW status="+(queued?"queued":"throttled")+" gameplay=false skill="+id);return;
        }
        if(args.length==3&&args[2].equalsIgnoreCase("audit")){audit(sender);return;}
        sender.sendMessage("mycli admin visuals audit|reload|preview <在线玩家> <技能ID>；preview仅粒子，不施法、不耗魔、不发成功事件");
    }
}
