package local.tlmcompat.hybrid;
public final class MaidConversationRulesFixture {
    public static void main(String[] args){
        String[][] pairs={{"肥鱼，你好","你好"},{"@肥鱼 你好","你好"},{" 肥鱼：你好 ","你好"},{"肥鱼池里有鱼",null},{"我和肥鱼聊天",null},{"!肥鱼，你好",null},{"/msg 肥鱼 你好",null},{"肥鱼",null},{"肥鱼，",null},{"肥鱼，\u00a7c你好",null},{"肥鱼，\n你好","你好"}};
        for(var row:pairs)if(!java.util.Objects.equals(row[1],MaidAddressing.addressed("肥鱼",row[0])))throw new AssertionError(row[0]);
        if(MaidAddressing.addressed("肥鱼","肥鱼，"+"字".repeat(141))!=null)throw new AssertionError("bounded text");
        if(MaidSpeechLines.forSound("minecraft:entity.villager.ambient")!=null)throw new AssertionError("foreign sounds");
        String[] events={"mode.idle","mode.attack","mode.range_attack","mode.danmaku_attack","mode.farm","mode.feed","mode.shears","mode.milk","mode.torch","mode.feed_animal","mode.extinguishing","mode.snow","mode.break","mode.furnace","mode.brewing","ai.find_target","ai.hurt","ai.hurt_fire","ai.hurt_player","ai.tamed","ai.item_get","ai.game_win","ai.game_lost","environment.hot","environment.cold","environment.rain","environment.snow","environment.morning","environment.night","credit"};
        for(String event:events)if(MaidSpeechLines.forSound("touhou_little_maid:maid."+event)==null)throw new AssertionError("missing native event "+event);
        if(MaidSpeechLines.forSound("touhou_little_maid:maid.ai_chat")!=null)throw new AssertionError("do not duplicate model reply");
        if(MaidSpeechLines.forSound("touhou_little_maid:maid.ai.death")!=null)throw new AssertionError("no speech after death");
        System.out.println("PASS 45 addressing and native sound rules");
    }
}
