package org.qiandengji.mcbot;

import com.google.gson.*;
import java.util.*;

/** Protocol scope, in addition to the native permission and protection layers. */
public final class Policy {
    public static final Set<String> TOOLS=Set.of("status","inventory","scan_area","find_resource","inspect_block",
            "equip","consume","craft","smelt","break_block","attack","follow","collect","place_block","move_to","transfer","wait",
            "command","use_item","use_block");
    private Policy(){}
    public static String bodyName(String name){
        if(!name.matches("[A-Za-z0-9_]{2,16}"))throw new IllegalArgumentException("名字须2至16位字母、数字或下划线");
        String lower=name.toLowerCase(Locale.ROOT);
        if(Set.of("corti","corticam","player","goddess").contains(lower)||lower.endsWith("_eye")||lower.endsWith("eye"))throw new IllegalArgumentException("保留的管理员或观战名不能用于新身体；请选择自己的角色名。");
        return name;
    }
    public static boolean readOnly(String tool,JsonObject args){
        return Set.of("status","inventory","scan_area","find_resource","inspect_block").contains(tool)
                ||tool.equals("craft")&&Wire.bool(args,"query",false)
                ||tool.equals("smelt")&&(!args.has("action")||Wire.string(args,"action",1,16).equals("query"));
    }
    public static void keys(JsonObject args,String... names){
        Set<String> allowed=Set.of(names);
        for(String key:args.keySet())if(!allowed.contains(key))throw new IllegalArgumentException("Paper后端尚不支持参数 "+key+"；未执行动作。");
    }
    public static String item(JsonObject args,String key){
        String id=Wire.string(args,key,1,128);if(!id.contains(":"))id="minecraft:"+id;
        if(!id.matches("[a-z0-9_.-]+:[a-z0-9_/.-]+"))throw new IllegalArgumentException("invalid item id");return id;
    }
    public static String command(String line){
        line=line.strip();if(line.startsWith("/"))line=line.substring(1);
        if(line.length()>240||line.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException("命令格式无效");
        String[] w=line.split("\\s+");
        if(w.length<2||!w[0].equals("mycli"))throw new IllegalArgumentException("仅支持本角色的 /mycli 玩法命令");
        String sub=w[1];boolean allowed=Set.of("status","help","--help","rules","cast","progress").contains(sub);
        if(w.length>=3){
            allowed|=switch(sub){
                case "profession"->Set.of("list","info","choose","menu","status").contains(w[2]);
                case "skills"->Set.of("list","info","tree","learn","prepare","status","menu").contains(w[2]);
                case "tasks"->Set.of("list","info","accept","status","claim","abandon").contains(w[2]);
                case "dungeon"->Set.of("list","info","status","start","join","leave","claim","menu").contains(w[2]);
                case "guild"->Set.of("status","join","shared","party","exam").contains(w[2]);
                case "arena"->w[2].equals("stash");
                case "inventory"->Set.of("status","list").contains(w[2]);
                default->false;
            };
        }
        if(!allowed||Arrays.stream(w).anyMatch(s->s.contains(";")||s.contains("\u00a7")))
            throw new IllegalArgumentException("命令不在本角色玩法白名单；管理、凭据和跨角色操作不开放。");
        return String.join(" ",w);
    }
}
