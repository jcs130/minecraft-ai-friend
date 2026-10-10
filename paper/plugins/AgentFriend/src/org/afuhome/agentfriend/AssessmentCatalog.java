package org.afuhome.agentfriend;

import com.google.gson.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

/** Bounded, immutable course definitions. Accepted runs keep their entire definition. */
final class AssessmentCatalog {
    static final Gson JSON = new Gson();
    static final Set<String> PROOFS = Set.of("cli_list", "cli_detail", "cli_status", "backpack_retrieve",
            "door_passage", "ladder_ascent", "shelter", "survey", "rescue", "party_clear", "project", "supply");
    record Point(double x, double y, double z) {
        double distance(Point b) { return Math.sqrt(Math.pow(x-b.x,2)+Math.pow(y-b.y,2)+Math.pow(z-b.z,2)); }
    }
    record Course(String id, UUID world, Point min, Point max, Point start, Point landing, List<Point> checkpoints) {
        boolean contains(Point p) { return p.x>=min.x && p.x<=max.x && p.y>=min.y && p.y<=max.y && p.z>=min.z && p.z<=max.z; }
    }
    record Definition(String id, String title, String description, String primitive, boolean enabled,
            List<String> skills, Course course, int timeout, double horizontal, double ascent, double turn,
            double backwards, double radius, int stableSeconds, int jumps, int allies, double allyMovement,
            boolean combatSupport, List<String> proofs, boolean allProofs, boolean reuseTraining, String prerequisite, String version) { }
    record Grade(int index, int fame, List<List<String>> prerequisites, List<String> fresh, String description) { }
    final Map<String, Definition> definitions;
    final List<Grade> grades;
    final boolean promotions;
    private AssessmentCatalog(Map<String, Definition> definitions, List<Grade> grades, boolean promotions) {
        this.definitions=Map.copyOf(definitions); this.grades=List.copyOf(grades); this.promotions=promotions;
    }
    static AssessmentCatalog load(File folder) throws Exception {
        YamlConfiguration y=new YamlConfiguration(); y.load(new File(folder,"skill-assessments.yml"));
        if(y.getInt("schema-version")!=1)throw new IllegalArgumentException("assessment schema-version");
        Map<String,Course> courses=new LinkedHashMap<>(); ConfigurationSection rows=section(y,"courses",32);
        for(String id:rows.getKeys(false)) {
            id(id);ConfigurationSection r=section(rows,id,10);var points=new ArrayList<Point>();
            for(Object point:r.getList("checkpoints",List.of()))points.add(point(point));
            Course c=new Course(id,UUID.fromString(r.getString("world-uuid","")),point(r.get("min")),point(r.get("max")),
                    point(r.get("start")),point(r.get("landing")),List.copyOf(points));
            validate(c);courses.put(id,c);
        }
        Map<String,Definition> definitions=new LinkedHashMap<>(); rows=section(y,"assessments",32);
        for(String id:rows.getKeys(false)) {
            id(id);ConfigurationSection r=section(rows,id,32);String course=r.getString("course","");
            if(!course.isEmpty()&&!courses.containsKey(course))throw new IllegalArgumentException(id+" missing course "+course);
            String primitive=r.getString("primitive","");
            Definition d=new Definition(id,text(r,"title",40),text(r,"description",180),primitive,r.getBoolean("enabled",true),
                    strings(r,"allowed-skills",4),courses.get(course),integer(r,"timeout-seconds",15,maxTimeout(primitive),120),
                    number(r,"horizontal-distance",0,512,0),number(r,"ascent",0,64,0),number(r,"turn-degrees",0,180,0),
                    number(r,"backwards-distance",0,32,0),number(r,"checkpoint-radius",.5,3,1.5),integer(r,"landing-stable-seconds",2,5,2),
                    integer(r,"jumps",1,3,1),integer(r,"other-allies",1,3,1),number(r,"ally-movement",2,32,4),
                    r.getBoolean("combat-support",false),strings(r,"proofs",8),r.getBoolean("all-proofs",true),r.getBoolean("reuse-training",false),
                    r.getString("prerequisite",""),"");
            validate(d);d=withVersion(d);definitions.put(id,d);
        }
        for(Definition d:definitions.values())if(!d.prerequisite.isEmpty()&&!definitions.containsKey(d.prerequisite))throw new IllegalArgumentException("missing prerequisite "+d.id);
        // Only one level of prerequisite; cyclic/cascading configuration cannot create unreachable learning gates.
        for(Definition d:definitions.values())if(!d.prerequisite.isEmpty()&&!definitions.get(d.prerequisite).prerequisite.isEmpty())throw new IllegalArgumentException("nested prerequisite "+d.id);
        YamlConfiguration g=new YamlConfiguration();g.load(new File(folder,"adventurer-grades.yml"));
        if(g.getInt("schema-version")!=1)throw new IllegalArgumentException("grade schema-version");
        var grades=new ArrayList<Grade>();List<Map<?,?>> list=g.getMapList("grades");
        if(list.size()!=18)throw new IllegalArgumentException("exactly 18 grades required");
        int previous=-1;int[] old={0,10,30,70,150,350};
        for(int i=0;i<list.size();i++) {
            YamlConfiguration r=new YamlConfiguration();list.get(i).forEach((k,v)->r.set(k.toString(),v));
            int fame=integer(r,"fame",0,100000,0);if(fame<=previous||i%3==0&&fame!=old[i/3])throw new IllegalArgumentException("grade fame compatibility/order "+i);
            previous=fame;List<List<String>> groups=new ArrayList<>();
            for(Object raw:r.getList("requires-any",List.of())) {
                if(!(raw instanceof List<?> group)||group.isEmpty()||group.size()>12)throw new IllegalArgumentException("grade group");
                List<String> ids=group.stream().map(Object::toString).toList();if(!definitions.keySet().containsAll(ids))throw new IllegalArgumentException("grade certificate");groups.add(ids);
            }
            List<String> fresh=strings(r,"fresh-any",12);
            if(groups.size()>8||!definitions.keySet().containsAll(fresh)||i>0&&fresh.isEmpty())throw new IllegalArgumentException("grade fresh exam");
            grades.add(new Grade(i,fame,List.copyOf(groups),fresh,text(r,"description",180)));
        }
        return new AssessmentCatalog(definitions,grades,g.getBoolean("enabled",true));
    }
    static String snapshot(Definition d) {return JSON.toJson(d);}
    static Definition frozen(String text) {
        if(text==null||text.length()>16384)throw new IllegalArgumentException("assessment snapshot size");
        Definition d=JSON.fromJson(text,Definition.class);validate(d);
        if(!withVersion(d).version.equals(d.version))throw new IllegalArgumentException("assessment snapshot hash");return d;
    }
    static boolean distinctGroups(List<List<String>> groups,Set<String> certificates) {
        Map<String,Integer> assigned=new HashMap<>();
        for(int i=0;i<groups.size();i++)if(!assignGroup(i,groups,certificates,assigned,new HashSet<>()))return false;
        return true;
    }
    private static boolean assignGroup(int index,List<List<String>> groups,Set<String> certificates,Map<String,Integer> assigned,Set<String> seen) {
        for(String id:groups.get(index))if(certificates.contains(id)&&seen.add(id)) {
            Integer prior=assigned.get(id);
            if(prior==null||assignGroup(prior,groups,certificates,assigned,seen)){assigned.put(id,index);return true;}
        }
        return false;
    }
    private static Definition withVersion(Definition d) {
        Definition clean=new Definition(d.id,d.title,d.description,d.primitive,d.enabled,d.skills,d.course,d.timeout,d.horizontal,d.ascent,d.turn,
                d.backwards,d.radius,d.stableSeconds,d.jumps,d.allies,d.allyMovement,d.combatSupport,d.proofs,d.allProofs,d.reuseTraining,d.prerequisite,"");
        try {
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(JSON.toJson(clean).getBytes(StandardCharsets.UTF_8)));
            return new Definition(d.id,d.title,d.description,d.primitive,d.enabled,d.skills,d.course,d.timeout,d.horizontal,d.ascent,d.turn,
                    d.backwards,d.radius,d.stableSeconds,d.jumps,d.allies,d.allyMovement,d.combatSupport,d.proofs,d.allProofs,d.reuseTraining,d.prerequisite,hash);
        }catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
    }
    static void validate(Definition d) {
        if(d==null)throw new IllegalArgumentException("missing definition");id(d.id);
        if(d.title==null||d.title.isBlank()||d.title.length()>40||d.description==null||d.description.isBlank()||d.description.length()>180
                ||!Set.of("flight_route","leap_route","support_route","native_lesson","contract_record").contains(d.primitive))throw new IllegalArgumentException("assessment text/primitive");
        if(d.skills==null||d.skills.size()>4||new HashSet<>(d.skills).size()!=d.skills.size()||d.proofs==null||d.proofs.size()>8
                ||!PROOFS.containsAll(d.proofs)||new HashSet<>(d.proofs).size()!=d.proofs.size()||d.prerequisite==null)throw new IllegalArgumentException("assessment lists");
        if(!d.prerequisite.isEmpty())id(d.prerequisite);
        bound(d.timeout,15,maxTimeout(d.primitive));bound(d.horizontal,0,512);bound(d.ascent,0,64);bound(d.turn,0,180);bound(d.backwards,0,32);
        bound(d.radius,.5,3);bound(d.stableSeconds,2,5);bound(d.jumps,1,3);bound(d.allies,1,3);bound(d.allyMovement,2,32);
        if(d.course!=null)validate(d.course);
        if(Set.of("flight_route","leap_route").contains(d.primitive)) {
            Set<String> allowed=d.primitive.equals("flight_route")?Set.of("flight","mage_soar"):Set.of("warrior_sky_leap");
            if(d.skills.isEmpty()||!allowed.containsAll(d.skills)||d.enabled&&d.course==null||!d.proofs.isEmpty())throw new IllegalArgumentException("mobility course/skills");
            if(d.primitive.equals("leap_route")&&d.course!=null&&(d.course.checkpoints.size()!=d.jumps||!d.course.landing.equals(d.course.checkpoints.getLast())))throw new IllegalArgumentException("leap ordered landing platforms");
        }else if(d.primitive.equals("support_route")) {
            if(!d.skills.equals(List.of("priest_blessing"))||d.course!=null||!d.proofs.isEmpty())throw new IllegalArgumentException("support skills");
        }else if(d.proofs.isEmpty()||!d.skills.isEmpty()||d.course!=null)throw new IllegalArgumentException("native proof requirements");
        // These six IDs unlock paid skill upgrades. Their names cannot be reassigned
        // to a trivial lesson or lower thresholds by a mistyped operations config.
        switch(d.id) {
            case "flight_basic", "flight_advanced" -> {
                boolean advanced=d.id.equals("flight_advanced");
                if(!d.primitive.equals("flight_route")||d.horizontal<(advanced?48:24)||d.ascent<(advanced?6:3)
                        ||d.turn<60||d.backwards<(advanced?6:4)||d.course!=null&&d.course.checkpoints.size()<3
                        ||advanced&&!d.prerequisite.equals("flight_basic"))throw new IllegalArgumentException("flight certificate minimums");
            }
            case "leap_basic", "leap_advanced" -> {
                boolean advanced=d.id.equals("leap_advanced");
                if(!d.primitive.equals("leap_route")||d.ascent<6||d.horizontal<(advanced?5:2)||d.jumps<(advanced?2:1)
                        ||advanced&&!d.prerequisite.equals("leap_basic"))throw new IllegalArgumentException("leap certificate minimums");
            }
            case "support_basic", "support_advanced" -> {
                boolean advanced=d.id.equals("support_advanced");
                if(!d.primitive.equals("support_route")||d.allies<(advanced?2:1)||d.allyMovement<4
                        ||advanced&&(!d.combatSupport||!d.prerequisite.equals("support_basic")))throw new IllegalArgumentException("support certificate minimums");
            }
        }
    }
    private static int maxTimeout(String primitive) {return "contract_record".equals(primitive)?86400:"native_lesson".equals(primitive)?7200:600;}
    private static void validate(Course c) {
        if(c.world==null||c.min==null||c.max==null||c.start==null||c.landing==null||c.checkpoints==null||c.checkpoints.isEmpty()||c.checkpoints.size()>8)throw new IllegalArgumentException("course fields");
        id(c.id);for(Point p:List.of(c.min,c.max,c.start,c.landing))validate(p);
        for(Point p:c.checkpoints){validate(p);if(!c.contains(p))throw new IllegalArgumentException("checkpoint outside course");}
        if(c.min.x>=c.max.x||c.min.y>=c.max.y||c.min.z>=c.max.z||c.max.x-c.min.x>256||c.max.z-c.min.z>256||c.max.y-c.min.y>128
                ||!c.contains(c.start)||!c.contains(c.landing))throw new IllegalArgumentException("course bounds/start/landing");
    }
    private static void validate(Point p) {bound(p.x,-29999900,29999900);bound(p.z,-29999900,29999900);bound(p.y,-64,1024);}
    private static Point point(Object raw) {
        if(!(raw instanceof List<?> p)||p.size()!=3||!(p.get(0) instanceof Number x)||!(p.get(1) instanceof Number y)||!(p.get(2) instanceof Number z))throw new IllegalArgumentException("point [x,y,z]");
        Point result=new Point(x.doubleValue(),y.doubleValue(),z.doubleValue());validate(result);return result;
    }
    private static ConfigurationSection section(ConfigurationSection y,String key,int max) {
        ConfigurationSection r=y.getConfigurationSection(key);if(r==null||r.getKeys(false).size()>max)throw new IllegalArgumentException("section "+key);return r;
    }
    private static String text(ConfigurationSection r,String key,int max) {
        String s=r.getString(key,"");if(s.isBlank()||s.length()>max||s.chars().anyMatch(c->c<32))throw new IllegalArgumentException(key+" text");return s;
    }
    private static List<String> strings(ConfigurationSection r,String key,int max) {
        List<String> list=r.getStringList(key);if(list.size()>max||new HashSet<>(list).size()!=list.size())throw new IllegalArgumentException(key+" count/duplicate");
        list.forEach(AssessmentCatalog::id);return List.copyOf(list);
    }
    private static void id(String s) {if(s==null||!s.matches("[a-z0-9_]{2,40}"))throw new IllegalArgumentException("ID");}
    private static void bound(double n,double min,double max) {if(!Double.isFinite(n)||n<min||n>max)throw new IllegalArgumentException("numeric bounds");}
    private static double number(ConfigurationSection r,String key,double min,double max,double fallback) {
        Object raw=r.get(key,fallback);if(!(raw instanceof Number n))throw new IllegalArgumentException(key+" number");double v=n.doubleValue();bound(v,min,max);return v;
    }
    private static int integer(ConfigurationSection r,String key,int min,int max,int fallback) {
        double n=number(r,key,min,max,fallback);if(n!=Math.rint(n))throw new IllegalArgumentException(key+" integer");return (int)n;
    }
}
