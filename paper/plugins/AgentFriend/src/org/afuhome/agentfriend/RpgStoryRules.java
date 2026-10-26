package org.afuhome.agentfriend;

import java.util.*;

/** Pure story conditions. Facts come from server ledgers or a nearby NPC action,
 * never from a player's chat, menu browsing or an NPC model's generated answer. */
final class RpgStoryRules {
    enum Kind { TALK, TALK_OR_GRADUATE, MEMBER, ENROLLED, CATALOG, CAST, COMMISSION, ROUTE, CONTRACT, COMBAT_ROLE, COMBAT_LEVEL, CONQUEST_CLEAR }
    static final Set<String> ROUTES=Set.of("combat","crafting","exploration","supply","engineering","life");
    record Stage(String id,String title,Kind kind,String reference,String description,String nextCommand) {
        Stage {
            id=RpgStoryRules.id(id); title=text(title,60); description=text(description,320);
            Objects.requireNonNull(kind); reference=reference==null?"":reference;
            nextCommand=text(nextCommand,180);
            if(!nextCommand.startsWith("/mycli "))throw new IllegalArgumentException("story advice must use an existing mycli entry");
            if(Set.of(Kind.TALK,Kind.TALK_OR_GRADUATE,Kind.CONTRACT).contains(kind))RpgStoryRules.id(reference);
            if(Set.of(Kind.COMBAT_LEVEL,Kind.CONQUEST_CLEAR).contains(kind)&&
                    (!reference.matches("[1-9][0-9]?|100")))throw new IllegalArgumentException("combat level/floor must be 1..100");
        }
    }
    record Chapter(String id,String title,String introduction,List<String> requires,List<Stage> stages) {
        Chapter {
            id=RpgStoryRules.id(id);title=text(title,60);introduction=text(introduction,480);
            requires=List.copyOf(requires);requires.forEach(RpgStoryRules::id);stages=List.copyOf(stages);
            if(stages.isEmpty()||stages.size()>12)throw new IllegalArgumentException("chapter needs 1..12 stages");
            if(stages.stream().map(Stage::id).distinct().count()!=stages.size())throw new IllegalArgumentException("duplicate stage ID");
        }
    }
    record Facts(boolean member,boolean enrolled,boolean catalog,boolean cast,boolean commission,
                 String route,Set<String> conversations,Set<String> contracts,
                 boolean combatRole,int combatLevel,Set<Integer> clearedFloors) {
        Facts(boolean member,boolean enrolled,boolean catalog,boolean cast,boolean commission,
              String route,Set<String> conversations,Set<String> contracts){
            this(member,enrolled,catalog,cast,commission,route,conversations,contracts,false,1,Set.of());
        }
        Facts {route=route==null?"":route;conversations=Set.copyOf(conversations);contracts=Set.copyOf(contracts);
            clearedFloors=Set.copyOf(clearedFloors);if(combatLevel<1||combatLevel>100||clearedFloors.stream().anyMatch(n->n<1||n>100))throw new IllegalArgumentException("invalid combat facts");}
        boolean graduated(){return member&&enrolled&&catalog&&cast&&commission;}
    }
    record Progress(int completed,int total,String currentId,List<String> completedIds) {
        Progress {completedIds=List.copyOf(completedIds);}
        boolean ready(){return completed==total;}
    }
    static boolean matches(Stage stage,Facts f){
        return switch(stage.kind){
            case TALK -> f.conversations.contains(stage.id+"@"+stage.reference);
            case TALK_OR_GRADUATE -> f.conversations.contains(stage.id+"@"+stage.reference)||f.graduated();
            case MEMBER -> f.member;
            case ENROLLED -> f.enrolled;
            case CATALOG -> f.catalog;
            case CAST -> f.cast;
            case COMMISSION -> f.commission;
            case ROUTE -> ROUTES.contains(f.route);
            case CONTRACT -> f.contracts.contains(stage.reference);
            case COMBAT_ROLE -> f.combatRole;
            case COMBAT_LEVEL -> f.combatLevel>=Integer.parseInt(stage.reference);
            case CONQUEST_CLEAR -> f.clearedFloors.contains(Integer.parseInt(stage.reference));
        };
    }
    static Progress evaluate(Chapter chapter,Facts facts){
        var complete=new ArrayList<String>();String current="";
        for(Stage stage:chapter.stages){if(!matches(stage,facts)){current=stage.id;break;}complete.add(stage.id);}
        return new Progress(complete.size(),chapter.stages.size(),current,complete);
    }
    static String id(String value){if(value==null||!value.matches("[a-z][a-z0-9_]{1,47}"))throw new IllegalArgumentException("invalid stable story ID");return value;}
    static String text(String value,int max){if(value==null||value.isBlank()||value.length()>max||value.chars().anyMatch(Character::isISOControl))throw new IllegalArgumentException("invalid bounded story text");return value;}
    private RpgStoryRules(){}
}
