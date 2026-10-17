package org.afuhome.agentfriend;

import java.io.File;
import java.util.*;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

/** Bounded authoring data; no executable console commands, scripts or model prompts. */
final class RpgStoryContent {
    record Topic(String id,String title,String text,String action,String target) { }
    record Npc(String id,String name,String role,String world,double x,double y,double z,String profession,
               String greeting,List<Topic> topics,List<String> offers) { }
    record Side(String id,String title,String npc,String introduction,List<String> contracts,List<String> requires) { }
    final String title;
    final int revision;
    final boolean enabled;
    final List<RpgStoryRules.Chapter> chapters;
    final List<Npc> npcs;
    final List<Side> sides;
    private static final Set<String> ACTIONS=Set.of("none","progress","rules","supplies","backpack","rewards","skills","guide","route","tasks","photo","encounter");
    private RpgStoryContent(String title,int revision,boolean enabled,List<RpgStoryRules.Chapter> chapters,List<Npc> npcs,List<Side> sides){
        this.title=title;this.revision=revision;this.enabled=enabled;this.chapters=List.copyOf(chapters);this.npcs=List.copyOf(npcs);this.sides=List.copyOf(sides);
    }
    static RpgStoryContent load(File file)throws Exception{
        if(file.length()>262144)throw new IllegalArgumentException("rpg-story.yml exceeds 256 KiB");
        var y=new YamlConfiguration();y.load(file);if(y.getInt("schema-version")!=1||!y.isBoolean("enabled"))throw new IllegalArgumentException("story schema/enabled");
        String title=text(y,"title",60);int revision=y.getInt("revision");if(revision<1)throw new IllegalArgumentException("story revision");
        var ns=section(y,"npcs");if(ns.getKeys(false).size()>8)throw new IllegalArgumentException("at most 8 story NPCs");
        var npcs=new ArrayList<Npc>();for(String id:ns.getKeys(false)){
            RpgStoryRules.id(id);var n=section(ns,id);var topics=new ArrayList<Topic>();var ts=section(n,"topics");
            if(ts.getKeys(false).size()>18)throw new IllegalArgumentException("at most 18 topics per NPC");
            for(String tid:ts.getKeys(false)){RpgStoryRules.id(tid);var t=section(ts,tid);String action=t.getString("action","none"),target=t.getString("target","");
                if(!ACTIONS.contains(action))throw new IllegalArgumentException("unknown NPC action");
                if(!target.isEmpty())RpgStoryRules.id(target);
                if(action.equals("route")&&!RpgStoryRules.ROUTES.contains(target))throw new IllegalArgumentException("route topic");
                topics.add(new Topic(tid,text(t,"title",50),text(t,"text",480),action,target));
            }
            for(String axis:List.of("x","y","z"))if(!(n.get(axis) instanceof Number))throw new IllegalArgumentException("explicit numeric NPC coordinate required: "+axis);
            String world=text(n,"world",64);double x=n.getDouble("x"),z=n.getDouble("z"),height=n.getDouble("y");
            if(!Double.isFinite(x)||!Double.isFinite(z)||!Double.isFinite(height)||Math.abs(x)>29999984||Math.abs(z)>29999984||height< -64||height>319)throw new IllegalArgumentException("NPC bounds");
            List<String> offers=ids(n,"offers",12);offers.forEach(RpgStoryContent::contractId);
            npcs.add(new Npc(id,text(n,"name",50),text(n,"role",60),world,x,height,z,text(n,"profession",32),text(n,"greeting",240),List.copyOf(topics),offers));
        }
        var cs=section(y,"chapters");if(cs.getKeys(false).isEmpty()||cs.getKeys(false).size()>8)throw new IllegalArgumentException("need 1..8 chapters");
        var chapters=new ArrayList<RpgStoryRules.Chapter>();for(String id:cs.getKeys(false))chapters.add(chapter(section(cs,id),id));
        var chapterIds=chapters.stream().map(RpgStoryRules.Chapter::id).toList();
        for(var c:chapters){for(String prior:c.requires())if(!chapterIds.contains(prior)||chapterIds.indexOf(prior)>=chapterIds.indexOf(c.id()))throw new IllegalArgumentException("chapter prerequisites must precede it");
            for(var stage:c.stages())if(Set.of(RpgStoryRules.Kind.TALK,RpgStoryRules.Kind.TALK_OR_GRADUATE).contains(stage.kind())&&npcs.stream().noneMatch(n->n.id.equals(stage.reference())))throw new IllegalArgumentException("unknown chapter NPC");}
        var sides=new ArrayList<Side>();var ss=section(y,"side-stories");if(ss.getKeys(false).size()>24)throw new IllegalArgumentException("at most 24 side stories");
        for(String id:ss.getKeys(false)){RpgStoryRules.id(id);var s=section(ss,id);String npc=s.getString("npc","");if(npcs.stream().noneMatch(n->n.id.equals(npc)))throw new IllegalArgumentException("unknown side NPC");
            List<String> contracts=ids(s,"contracts",8);if(contracts.isEmpty())throw new IllegalArgumentException("side story needs a real commission");contracts.forEach(RpgStoryContent::contractId);
            sides.add(new Side(id,text(s,"title",60),npc,text(s,"introduction",480),contracts,ids(s,"requires",8)));}
        for(int i=0;i<sides.size();i++)for(String prior:sides.get(i).requires)if(sides.subList(0,i).stream().noneMatch(s->s.id.equals(prior)))throw new IllegalArgumentException("side prerequisites must precede it");
        return new RpgStoryContent(title,revision,y.getBoolean("enabled"),chapters,npcs,sides);
    }
    static RpgStoryRules.Chapter chapter(ConfigurationSection c,String id){
        var stages=new ArrayList<RpgStoryRules.Stage>();var gs=section(c,"stages");
        for(String key:gs.getKeys(false)){var s=section(gs,key);stages.add(new RpgStoryRules.Stage(key,text(s,"title",60),RpgStoryRules.Kind.valueOf(s.getString("kind","").toUpperCase(Locale.ROOT)),s.getString("reference",""),text(s,"description",320),text(s,"next-command",180)));}
        return new RpgStoryRules.Chapter(id,text(c,"title",60),text(c,"introduction",480),ids(c,"requires",8),stages);
    }
    static String freeze(RpgStoryRules.Chapter chapter){var y=new YamlConfiguration();y.set("id",chapter.id());y.set("title",chapter.title());y.set("introduction",chapter.introduction());y.set("requires",chapter.requires());
        for(var stage:chapter.stages()){String b="stages."+stage.id()+".";y.set(b+"title",stage.title());y.set(b+"kind",stage.kind().name());y.set(b+"reference",stage.reference());y.set(b+"description",stage.description());y.set(b+"next-command",stage.nextCommand());}return y.saveToString();}
    static RpgStoryRules.Chapter thaw(String text)throws Exception{if(text.length()>32768)throw new IllegalArgumentException("frozen chapter size");var y=new YamlConfiguration();y.loadFromString(text);return chapter(y,y.getString("id",""));}
    Npc npc(String id){return npcs.stream().filter(n->n.id.equals(id)).findFirst().orElse(null);}
    Side side(String id){return sides.stream().filter(s->s.id.equals(id)).findFirst().orElse(null);}
    RpgStoryRules.Chapter chapter(String id){return chapters.stream().filter(c->c.id().equals(id)).findFirst().orElse(null);}
    private static ConfigurationSection section(ConfigurationSection y,String key){var c=y.getConfigurationSection(key);if(c==null)throw new IllegalArgumentException("missing story section "+key);return c;}
    private static String text(ConfigurationSection y,String key,int max){return RpgStoryRules.text(y.getString(key),max);}
    private static List<String> ids(ConfigurationSection y,String key,int max){List<String> values=y.getStringList(key);if(values.size()>max||new HashSet<>(values).size()!=values.size())throw new IllegalArgumentException("invalid list "+key);values.forEach(RpgStoryRules::id);return List.copyOf(values);}
    private static void contractId(String id){if(!id.startsWith("tm_"))throw new IllegalArgumentException("only existing task market IDs may be linked");}
}
