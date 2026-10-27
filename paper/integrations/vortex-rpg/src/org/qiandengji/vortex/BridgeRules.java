package org.qiandengji.vortex;

import java.util.*;

/** Small shared CLI grammar: help is read-only and invalid input fails before dispatch. */
public final class BridgeRules {
    public record Request(String group, String action, List<String> arguments, boolean json, boolean help) {}
    public static final List<String> GROUPS=List.of("status","class","skills","cast","quests","shop","town");
    public static Request parse(String[] raw) {
        List<String> words=new ArrayList<>(); boolean json=false,help=false;
        for(String value:raw) {
            if(value.equals("--json"))json=true;
            else if(value.equals("--help")||value.equals("-h"))help=true;
            else if(value.startsWith("--"))throw new IllegalArgumentException("未知选项；查看 /mycli --help");
            else words.add(value.toLowerCase(Locale.ROOT));
        }
        if(!words.isEmpty()&&words.getFirst().equals("rpg"))words.removeFirst();
        String group=words.isEmpty()?"status":words.removeFirst();
        // Reuse the server vocabulary; early rpg/class/quests paths stay aliases.
        group=switch(group){case "profession"->"class";case "tasks"->"quests";case "trade"->"shop";case "waypoint"->"town";default->group;};
        if(!GROUPS.contains(group))throw new IllegalArgumentException("未知分组；查看 /mycli --help");
        String action=words.isEmpty()?"list":words.removeFirst();
        if(help)return new Request(group,action,List.copyOf(words),json,true);
        int max=switch(group){case "status"->0;case "cast"->1;default->2;};
        // cast <ID> is intentionally one action, rather than another command family.
        if(group.equals("cast")){words.addFirst(action);action="cast";if(words.getFirst().equals("list"))throw new IllegalArgumentException("需要技能ID；查看 /mycli skills status");}
        else if(group.equals("status")&&!action.equals("list"))throw new IllegalArgumentException("status 无参数");
        if(words.size()>max)throw new IllegalArgumentException("参数过多；查看 /mycli --help");
        for(String w:words)if(!w.matches("[a-z0-9_]{1,48}"))throw new IllegalArgumentException("ID只能用字母、数字和下划线");
        return new Request(group,action,List.copyOf(words),json,false);
    }
    public static String id(Request r){if(r.arguments().size()!=1)throw new IllegalArgumentException("需要一个ID；查看 /mycli rpg "+r.group()+" --help");return r.arguments().getFirst();}
    public static String className(String id){return switch(id){case "knight"->"骑士（坦克）";case "mage"->"法师";case "ranger"->"游侠";case "cleric"->"牧师";case "beastmaster"->"驯兽师";case "engineer"->"工程师";default->id;};}
}
