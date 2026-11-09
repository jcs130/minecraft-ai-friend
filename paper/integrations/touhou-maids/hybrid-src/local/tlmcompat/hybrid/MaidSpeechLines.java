package local.tlmcompat.hybrid;

/** Original Chinese lines, not translations or copies of third-party voice recordings. */
final class MaidSpeechLines {
    private MaidSpeechLines(){}
    static String forSound(String sound,int variant){
        if("touhou_little_maid:maid.mode.idle".equals(sound)){
            String[] lines={"我在你身边，准备好了就一起出发吧。","出发前记得看看护甲和补给。","想去探索时叫上我，我们一起走。","需要帮忙可以直接叫我的名字。","有合适的武器，我也能帮你应付路上的怪物。","休息一会儿也好，准备好了再继续冒险。"};
            return lines[Math.floorMod(variant,lines.length)];
        }
        return forSound(sound);
    }
    static String forSound(String sound){
        if(sound==null||!sound.startsWith("touhou_little_maid:"))return null;
        return switch(sound.substring(sound.indexOf(':')+1)){
            case "maid.mode.idle" -> "我在这里，有事可以叫我。";
            case "maid.mode.attack","maid.mode.range_attack","maid.mode.danmaku_attack" -> "交给我吧，注意身边的敌人。";
            case "maid.mode.farm" -> "我会照料好这里，出发时记得叫我。";
            case "maid.mode.feed" -> "带上吃的，一起出发吧。";
            case "maid.mode.shears" -> "剪刀准备好了，我会小心使用。";
            case "maid.mode.milk" -> "空桶准备好了吗？";
            case "maid.mode.torch" -> "这里有点暗，我来照亮道路。";
            case "maid.mode.feed_animal" -> "小动物们，该吃东西啦。";
            case "maid.mode.extinguishing" -> "注意火，我来帮忙。";
            case "maid.mode.snow" -> "我来把积雪清一清。";
            case "maid.mode.break" -> "工具带好了，我会留意周围。";
            case "maid.mode.furnace" -> "我去看看炉子，别忘了准备燃料。";
            case "maid.mode.brewing" -> "酿造材料备齐了吗？";
            case "maid.ai.find_target" -> "前面有敌人，小心一点。";
            case "maid.ai.hurt","maid.ai.hurt_fire","maid.ai.hurt_player" -> "哎呀，我会小心的。";
            case "maid.ai.tamed" -> "你好呀，以后一起去冒险吧。";
            case "maid.ai.item_get" -> "东西收好啦。";
            case "maid.ai.game_win" -> "赢啦，合作得真不错。";
            case "maid.ai.game_lost" -> "这次没成功，下次再试试。";
            case "maid.environment.hot" -> "这里好热，找个凉快的地方吧。";
            case "maid.environment.cold","maid.environment.snow" -> "有点冷，出门记得做好准备。";
            case "maid.environment.rain" -> "下雨了，我们找个地方避一避吧。";
            case "maid.environment.morning" -> "早上好，今天想去哪里冒险？";
            case "maid.environment.night" -> "天黑了，走路要留意周围。";
            case "maid.credit" -> "谢谢你陪着我，一起看看这个世界吧。";
            // Death cannot start new speech; AI chat is spoken from its actual reply.
            case "maid.ai.death","maid.ai_chat" -> null;
            default -> null;
        };
    }
}
