package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Read-only retrieval over the current server catalog. Nothing here dispatches a command. */
final class AgentCliRecovery {
    record Card(String id,String usage,String summary,String requirements) {
        String document(){return id+" "+usage+" "+summary+" "+requirements;}
        String help(){return "/mycli "+id.replace('.',' ')+" --help";}
    }
    record Context(Set<String> dungeonIds,Set<String> onlineNames) {
        Context {
            dungeonIds=dungeonIds.stream().filter(id->id.matches("[a-z0-9_-]{1,64}")).collect(java.util.stream.Collectors.toUnmodifiableSet());
            onlineNames=onlineNames.stream().filter(name->name.matches("[.\\p{L}0-9_]{1,16}")).collect(java.util.stream.Collectors.toUnmodifiableSet());
        }
        static Context empty(){return new Context(Set.of(),Set.of());}
    }
    record Match(Card card,String nextCommand,double score,String method) { }
    private record Vector(Map<String,Double> terms,double norm) { }
    private record Index(List<Card> cards,List<Vector> vectors,List<List<String>> paths,String revision) { }
    private static volatile Index cachedIndex;
    private static final String[][] CONCEPTS={
        {"teleport","teleportation","tp","warp","travel","传送","传送术","移动","前往","去往","抵达","到达"},
        {"team","teammate","partner","队友","伙伴","集合","找人","支援"},
        {"dungeon","ruins","crypt","副本","地下城","遗迹","墓穴","远征"},
        {"home","回家","归乡","回城","返回村庄","村庄出生点"},
        {"waypoint","personal","传送点","私人地点","自定义地点","记录地点"},
        {"blink","闪现","瞬移","短距离"},
        {"heal","selfheal","治疗","回血","加血","圣愈","恢复生命"},
        {"party","组队","邀请","入队","队伍"},
        {"inventory","bag","backpack","背包","物品","满了","存箱"},
        {"recycle","sell","回收","分解","卖掉","金币"},
        {"shop","buy","purchase","商城","商店","购买","买东西","补给"},
        {"skills","spell","法术","技能","施法","学习"},
        {"profession","class","职业","选职"},
        {"quest","tasks","委托","任务"},
        {"cancel","abandon","取消","放弃","退出"}
    };
    private AgentCliRecovery(){}
    static void warm(List<Card> cards){index(cards);}
    private static Index index(List<Card> cards){
        Index cached=cachedIndex;if(cached!=null&&(cached.cards()==cards||cached.cards().equals(cards)))return cached;
        Index built=new Index(List.copyOf(cards),cards.stream().map(c->vector(c.document())).toList(),cards.stream().map(c->pathWords(c.id().replace('.',' ').replaceFirst("^cast\\s+",""))).toList(),digest(cards));
        cachedIndex=built;return built;
    }

    static String query(String[] raw){
        if(raw==null||raw.length>32)return "";
        var words=new ArrayList<String>();
        for(String value:raw){
            if(value==null||value.length()>128||value.codePoints().anyMatch(c->Character.isISOControl(c)||c==0x00a7))return "";
            if(value.startsWith("--")||value.equals("-h"))continue;
            words.add(value.toLowerCase(Locale.ROOT));
        }
        String query=String.join(" ",words);
        if(query.length()>240||query.matches("(?is).*(password|passwd|authorization|bearer|api.?key|token|/login|密码|口令|密钥|验证码|srv_[a-z0-9_-]{12}|obs_[a-z0-9_-]{12}).*"))return "";
        return query;
    }
    /** Remove confirmed role/target names and opaque parameters before optional embeddings. */
    static String semanticQuery(String[] raw,Context context){
        String q=query(raw);if(q.isEmpty())return q;
        for(String name:context.onlineNames())q=q.replace(name.toLowerCase(Locale.ROOT)," 玩家 ");
        for(String id:context.dungeonIds())q=q.replace(id.toLowerCase(Locale.ROOT)," 地下城 ");
        return q.replaceAll("[a-f0-9]{8}-[a-f0-9-]{27,}"," 目标 ").replaceAll("[a-z0-9_-]{32,}"," 参数 ").trim();
    }
    static String revision(List<Card> cards){return index(cards).revision();}
    private static String digest(List<Card> cards){
        try{
            var digest=MessageDigest.getInstance("SHA-256");
            for(Card card:cards.stream().sorted(Comparator.comparing(Card::id)).toList())digest.update((card.document()+"\n").getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest.digest()).substring(0,16);
        }catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
    }
    static List<Match> suggest(String[] raw,List<Card> cards,Context context){
        String q=query(raw);if(q.isEmpty())return List.of();
        var routed=misplacedCast(raw,cards,context);if(!routed.isEmpty())return routed;
        List<Match> exact=contextMatches(q,cards,context);if(!exact.isEmpty())return exact;
        Vector query=vector(q);Index index=index(cards);var matches=new ArrayList<Match>();
        List<String> words=pathWords(q.replaceFirst("^(?:mycli|cast|施法)\\s+",""));
        for(int item=0;item<cards.size();item++){
            Card card=cards.get(item);double lexical=cosine(query,index.vectors().get(item));
            double spelling=wordSimilarity(words,index.paths().get(item));
            double score=.75*lexical+.25*spelling;
            if(score>=.16)matches.add(new Match(card,safeNext(card),score,"catalog_terms_and_aliases"));
        }
        return top(matches);
    }
    /** Exact catalog routing beats fuzzy retrieval. Advice only; never dispatch. */
    static List<Match> misplacedCast(String[] raw,List<Card> cards,Context context){
        String q=query(raw);if(q.isEmpty())return List.of();
        var words=new ArrayList<>(Arrays.asList(q.split("\\s+")));
        if(words.size()<2||!Set.of("cast","施法","咏唱").contains(words.removeFirst()))return List.of();
        String first=words.getFirst();
        // A real configured spell with a colliding name keeps its real validator.
        if(cards.stream().anyMatch(c->c.id().equals("cast."+first)))return List.of();
        // Some hosts put the action before its domain: "cast resume dungeon".
        // Reorder only an exact enabled catalog path; this remains advice.
        if(words.size()>=2&&cards.stream().anyMatch(c->!c.id().startsWith("cast.")&&c.id().equals(words.get(1)+"."+first))){
            words.set(0,words.get(1));words.set(1,first);
        }
        for(Card card:cards)if(!card.id().startsWith("cast.")&&card.id().replace('.','_').equals(first)){
            words.removeFirst();words.addAll(0,Arrays.asList(card.id().split("\\.")));break;
        }
        Card best=null;List<String> path=List.of();
        for(Card card:cards){
            if(card.id().equals("cast")||card.id().startsWith("cast."))continue;
            var literal=new ArrayList<String>();String[] usage=card.usage().split("\\s+");
            if(usage.length<2||!usage[0].equals("/mycli"))continue;
            for(int i=1;i<usage.length&&usage[i].matches("[a-z][a-z0-9_-]*");i++)literal.add(usage[i]);
            if(literal.isEmpty()||literal.size()>words.size()||literal.size()<=path.size())continue;
            if(words.subList(0,literal.size()).equals(literal)){best=card;path=List.copyOf(literal);}
        }
        if(best==null)return List.of();
        String next=best.help();
        // Fill a target only after confirming it against the live dungeon catalog.
        if(path.size()==2&&path.getFirst().equals("dungeon")&&words.size()==3){
            String target=words.get(2);
            if(context.dungeonIds().contains(target)){
                String literal="/mycli "+String.join(" ",path);
                String usage=best.usage().toLowerCase(Locale.ROOT);
                if(usage.startsWith(literal+" <id>")||usage.startsWith(literal+" [id]"))next=literal+" "+target;
                else if(best.usage().equals(literal))next=literal;
            }
        }else if(words.size()==path.size()){
            next=safeNext(best);
        }
        return List.of(new Match(best,next,1,"misplaced_cast_prefix"));
    }
    static List<Match> semantic(String[] raw,List<Card> cards,Context context,double[] vector,List<double[]> indexed){
        if(!contextMatches(query(raw),cards,context).isEmpty())return suggest(raw,cards,context);
        if(indexed.size()!=cards.size())throw new IllegalArgumentException("VECTOR_CATALOG_MISMATCH");
        var matches=new ArrayList<Match>();
        for(int i=0;i<cards.size();i++){double score=cosine(vector,indexed.get(i));if(score>=.55)matches.add(new Match(cards.get(i),safeNext(cards.get(i)),score,"semantic_embedding"));}
        return top(matches);
    }
    private static List<Match> contextMatches(String q,List<Card> cards,Context context){
        if(q.isEmpty())return List.of();Set<String> tokens=new HashSet<>(Arrays.asList(q.split("\\s+")));
        Set<String> parts=new HashSet<>(Arrays.asList(q.split("[^a-z0-9]+")));
        boolean travel=Arrays.stream(CONCEPTS[0]).anyMatch(a->a.chars().allMatch(c->c<128)?parts.contains(a):q.contains(a))||q.contains("传送点术")||parts.contains("teleprot");
        if(!travel)return List.of();
        var targets=context.dungeonIds().stream().filter(id->tokens.contains(id.toLowerCase(Locale.ROOT))).sorted().toList();
        var partners=context.onlineNames().stream().filter(name->tokens.contains(name.toLowerCase(Locale.ROOT))).sorted().toList();
        if(targets.size()+partners.size()>1){
            var choices=new ArrayList<Match>();
            if(!targets.isEmpty())cards.stream().filter(c->c.id().equals("dungeon.travel")).findFirst().ifPresent(c->choices.add(new Match(c,"/mycli dungeon list",1,"confirmed_targets_need_selection")));
            if(!partners.isEmpty())cards.stream().filter(c->c.id().equals("locate.tp")).findFirst().ifPresent(c->choices.add(new Match(c,"/mycli locate list",1,"confirmed_targets_need_selection")));
            return List.copyOf(choices);
        }
        for(String id:targets){
            var card=cards.stream().filter(c->c.id().equals("dungeon.travel")).findFirst();
            if(card.isPresent())return List.of(new Match(card.get(),"/mycli dungeon travel "+id,1,"confirmed_dungeon_target"));
        }
        for(String name:partners){
            var card=cards.stream().filter(c->c.id().equals("locate.tp")).findFirst();
            if(card.isPresent())return List.of(new Match(card.get(),"/mycli locate tp "+name,1,"confirmed_online_target"));
        }
        return List.of();
    }
    private static String safeNext(Card card){
        if(card.id().equals("dungeon.travel"))return "/mycli dungeon list";
        if(card.id().equals("locate.tp"))return "/mycli locate list";
        String command=card.usage().replaceFirst("\\s+\\[.*$","").trim();
        if(command.startsWith("/mycli ")&&command.length()<=240&&!command.matches("(?s).*[<>|;；\\r\\n].*"))return command;
        return card.help();
    }
    static JsonObject payload(List<Match> matches,List<Card> cards,String errorCode,String message){
        var out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("success",false);out.addProperty("changed",false);
        out.addProperty("errorCode",errorCode);out.addProperty("reason",errorCode);out.addProperty("message",message);
        out.addProperty("retryable",false);out.addProperty("readOnly",true);out.addProperty("autoExecute",false);
        out.addProperty("catalogRevision",revision(cards));out.addProperty("nextCommand",matches.isEmpty()?"/mycli --help":matches.getFirst().nextCommand());
        var suggestions=new JsonArray();for(Match match:matches){var row=new JsonObject();row.addProperty("id",match.card().id());row.addProperty("usage",match.card().usage());row.addProperty("summary",match.card().summary());row.addProperty("requirements",match.card().requirements());row.addProperty("nextCommand",match.nextCommand());row.addProperty("lookupMethod",match.method());row.addProperty("rankingScore",Math.round(match.score()*1000)/1000d);suggestions.add(row);}
        out.add("suggestions",suggestions);out.addProperty("retryPolicy","本次未执行、未扣费。选择并核对建议后，由本人重新发出正确命令；相近候选不是执行成功或可用性保证。");return out;
    }
    static List<String> text(JsonObject out){
        var lines=new ArrayList<String>();lines.add("["+out.get("errorCode").getAsString()+"] "+out.get("message").getAsString()+"；本次未执行、未扣费。");
        JsonArray rows=out.getAsJsonArray("suggestions");
        for(int i=0;i<Math.min(2,rows.size());i++){var row=rows.get(i).getAsJsonObject();lines.add((i==0?"建议：":"也可查：")+row.get("usage").getAsString()+"；"+row.get("summary").getAsString()+(i==0?"；条件："+row.get("requirements").getAsString():""));}
        lines.add("下一步："+out.get("nextCommand").getAsString());return List.copyOf(lines);
    }
    private static List<Match> top(List<Match> matches){
        var unique=new LinkedHashMap<String,Match>();
        matches.stream().sorted(Comparator.comparingDouble(Match::score).reversed().thenComparing(m->m.card().id())).forEach(m->unique.putIfAbsent(m.card().usage(),m));
        return unique.values().stream().limit(3).toList();
    }
    private static Map<String,Double> terms(String value){
        String text=value.toLowerCase(Locale.ROOT);var out=new HashMap<String,Double>();
        for(String token:text.split("[^a-z0-9]+"))if(token.length()>1)out.merge(token,1d,Double::sum);
        var han=java.util.regex.Pattern.compile("[\\p{IsHan}]{2,}").matcher(text);
        while(han.find()){String s=han.group();for(int i=0;i<s.length()-1;i++)out.merge(s.substring(i,i+2),.6,Double::sum);}
        for(int i=0;i<CONCEPTS.length;i++)if(Arrays.stream(CONCEPTS[i]).anyMatch(alias->alias.chars().allMatch(c->c<128)?Arrays.asList(text.split("[^a-z0-9]+" )).contains(alias):text.contains(alias)))out.put("concept:"+i,2d);
        return out;
    }
    private static Vector vector(String text){Map<String,Double> values=Map.copyOf(terms(text));double norm=Math.sqrt(values.values().stream().mapToDouble(n->n*n).sum());return new Vector(values,norm);}
    private static double cosine(Vector a,Vector b){if(!(a.norm()>0&&b.norm()>0))return 0;double dot=0;for(var row:a.terms().entrySet())dot+=row.getValue()*b.terms().getOrDefault(row.getKey(),0d);return dot/(a.norm()*b.norm());}
    static double cosine(double[] a,double[] b){
        if(a.length<2||a.length>8192||a.length!=b.length)throw new IllegalArgumentException("VECTOR_DIMENSION_MISMATCH");
        double dot=0,aa=0,bb=0;for(int i=0;i<a.length;i++){if(!Double.isFinite(a[i])||!Double.isFinite(b[i]))throw new IllegalArgumentException("VECTOR_NOT_FINITE");dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
        if(!(aa>0&&bb>0))throw new IllegalArgumentException("VECTOR_EMPTY");
        double result=dot/Math.sqrt(aa*bb);if(!Double.isFinite(result))throw new IllegalArgumentException("VECTOR_NOT_FINITE");return Math.max(-1,Math.min(1,result));
    }
    private static List<String> pathWords(String value){return Arrays.stream(value.split("[^a-z]+" )).filter(s->!s.isEmpty()).toList();}
    private static double wordSimilarity(List<String> left,List<String> right){
        double total=0;for(int word=0;word<Math.min(left.size(),right.size());word++){
            String x=left.get(word),y=right.get(word);
            if(x.equals(y)){total++;continue;}
            if(x.length()<3||y.length()<3||Math.abs(x.length()-y.length())>2)continue;
            int[] prev=new int[y.length()+1];for(int j=0;j<prev.length;j++)prev[j]=j;
            for(int i=1;i<=x.length();i++){int[] cur=new int[y.length()+1];cur[0]=i;for(int j=1;j<=y.length();j++)cur[j]=Math.min(Math.min(cur[j-1]+1,prev[j]+1),prev[j-1]+(x.charAt(i-1)==y.charAt(j-1)?0:1));prev=cur;}
            if(prev[y.length()]<=2)total+=1-(double)prev[y.length()]/Math.max(x.length(),y.length());
        }return total/Math.max(1,Math.max(left.size(),right.size()));
    }
}
