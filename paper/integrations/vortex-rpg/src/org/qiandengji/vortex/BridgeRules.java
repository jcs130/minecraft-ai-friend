package org.qiandengji.vortex;

import java.util.*;

/** Validate the whole request before looking up a profile or executing an action. */
public final class BridgeRules {
    public record Request(String group, String action, List<String> arguments, boolean json, boolean help, int page) {
        public Request(String group,String action,List<String> arguments,boolean json,boolean help){this(group,action,arguments,json,help,1);}
    }
    public static final int PAGE_SIZE=7;
    public static final class InvalidArgument extends IllegalArgumentException {
        private final String nextCommand;
        InvalidArgument(String message,String next){super("[invalid_argument] "+message+"；未执行。下一步："+next);this.nextCommand=next;}
        public String nextCommand(){return nextCommand;}
    }
    public static final List<String> GROUPS=List.of("status","class","skills","cast","quests","shop","town");
    private static final Map<String,Set<String>> ACTIONS=Map.of(
        "class",Set.of("status","list","info","choose","menu"),
        "skills",Set.of("status","list","mine","points","info","explain","learn","prepare","equip","tree","menu"),
        "quests",Set.of("status","list","info","accept","claim","abandon"),
        "shop",Set.of("list","info","open"),"town",Set.of("list","info"));
    public static String publicGroup(String group){return switch(group){case "class"->"profession";case "quests"->"tasks";case "shop"->"trade";case "town"->"waypoint";default->group;};}
    public static Request parse(String[] raw) {
        List<String> words=new ArrayList<>();boolean json=false,help=false,seenPage=false;int page=1;
        for(int i=0;i<raw.length;i++) {
            String value=raw[i];
            if(value.equals("--json"))json=true;
            else if(value.equals("--help")||value.equals("-h"))help=true;
            else if(value.equals("--page")){
                if(seenPage||++i==raw.length)throw invalid("--page 需要一个正整数","/mycli --help");
                try{page=Integer.parseInt(raw[i]);}catch(NumberFormatException e){throw invalid("--page 需要一个正整数","/mycli --help");}
                if(page<1)throw invalid("--page 需要一个正整数","/mycli --help");seenPage=true;
            }
            else if(value.startsWith("-"))throw invalid("未知选项 "+value,"/mycli --help");
            else words.add(value.toLowerCase(Locale.ROOT));
        }
        if(!words.isEmpty()&&words.getFirst().equals("rpg"))words.removeFirst();
        String group=words.isEmpty()?"status":words.removeFirst();
        // Reuse the server vocabulary; early rpg/class/quests paths stay aliases.
        group=switch(group){case "profession","职业"->"class";case "tasks","任务路线"->"quests";case "spells","技能"->"skills";case "trade"->"shop";case "waypoint"->"town";default->group;};
        if(!GROUPS.contains(group))throw invalid("未知分组","/mycli --help");
        String action=words.isEmpty()?(Set.of("class","skills","quests").contains(group)?"status":"list"):words.removeFirst();
        if(help)return new Request(group,action,List.copyOf(words),json,true,page);
        if(group.equals("cast")){
            if(action.equals("list"))throw invalid("缺少技能ID；用法：/mycli cast <ID>","/mycli skills list");
            words.addFirst(action);action="cast";
        }else if(group.equals("status")){
            if(!action.equals("list"))throw invalid("status 无参数","/mycli status");
        }else if(!ACTIONS.get(group).contains(action))throw invalid("未知动作 "+action,"/mycli "+publicGroup(group)+" --help");
        Request r=new Request(group,action,List.copyOf(words),json,false,page);
        boolean id=Set.of("info","explain","choose","learn","prepare","equip","accept","claim","abandon","open","cast").contains(action);
        boolean optional=action.equals("status")&&Set.of("skills","quests").contains(group)||group.equals("skills")&&action.equals("list");
        if(id&&words.size()!=1||!id&&words.size()>(optional?1:0))throw invalid("参数不匹配；用法：/mycli "+publicGroup(group)+(group.equals("cast")?" <ID>":" "+action+(id?" <ID>":optional?" [ID]":"")),"/mycli "+publicGroup(group)+" --help");
        for(String w:words)if(!w.matches("[a-z0-9_]{1,48}"))throw invalid("ID只用字母、数字和下划线","/mycli "+publicGroup(group)+" --help");
        if(group.equals("skills")&&action.equals("list")&&!words.isEmpty()&&!words.equals(List.of("common")))throw invalid("list 仅接受 common；查单项用 skills info <ID>","/mycli skills list");
        boolean pageable=group.equals("quests")&&Set.of("list","status").contains(action)&&words.isEmpty();
        if(seenPage&&!pageable)throw invalid("这个动作不接受 --page","/mycli "+publicGroup(group)+" --help");
        return r;
    }
    private static InvalidArgument invalid(String message,String next){return new InvalidArgument(message,next);}
    public static String id(Request r){if(r.arguments().size()!=1)throw invalid("缺少一个ID","/mycli "+publicGroup(r.group())+" --help");return r.arguments().getFirst();}
    public static int pages(int total){return Math.max(1,(total+PAGE_SIZE-1)/PAGE_SIZE);}
    public static <T> List<T> page(List<T> rows,Request r){int pages=pages(rows.size());if(r.page()>pages)throw invalid("页码范围 1–"+pages,"/mycli tasks "+r.action());return rows.subList((r.page()-1)*PAGE_SIZE,Math.min(r.page()*PAGE_SIZE,rows.size()));}
    public static Map<String,Object> pagination(int total,Request r){var out=new LinkedHashMap<String,Object>();out.put("page",r.page());out.put("pages",pages(total));out.put("total",total);if(r.page()<pages(total))out.put("nextCommand","/mycli "+publicGroup(r.group())+" "+r.action()+" --page "+(r.page()+1)+(r.json()?" --json":""));return out;}
    public static String nextPage(int total,Request r){return r.page()<pages(total)?"；下一页："+pagination(total,r).get("nextCommand"):"";}
    public static String className(String id){return switch(id){case "none",""->"未选择职业";case "knight"->"骑士（坦克）";case "mage"->"法师";case "ranger"->"游侠";case "cleric"->"牧师";case "beastmaster"->"驯兽师";case "engineer"->"工程师";default->id;};}
}
