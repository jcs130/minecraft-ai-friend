package dev.qiandeng.maw;
import com.google.gson.*;
import java.lang.reflect.*;
public final class NativeModAccessTest {
    static int checks;
    static void check(boolean ok){checks++;if(!ok)throw new AssertionError("check "+checks);}
    static void validate(String id,String arguments,boolean accepted)throws Exception {
        var schema=NativeModAccess.catalog(id).getAsJsonObject("operation").getAsJsonObject("parameters");
        var method=NativeModAccess.class.getDeclaredMethod("validate",JsonElement.class,JsonObject.class,int.class);method.setAccessible(true);
        boolean valid=true;try{method.invoke(null,JsonParser.parseString(arguments),schema,0);}catch(InvocationTargetException e){if(!(e.getCause() instanceof IllegalArgumentException))throw e;valid=false;}
        check(valid==accepted);
    }
    public static void main(String[] args)throws Exception {
        check(NativeModAccess.catalog("").get("operationCount").getAsInt()==72);
        check(NativeModAccess.catalog("").getAsJsonArray("operations").size()==72);
        validate("society.state","{}",true);
        validate("society.state","{\"playerUuid\":\"other\"}",false);
        validate("society.accept","{\"questId\":\"maw:wheat_delivery\"}",true);
        validate("society.accept","{\"questId\":\"../accounts\"}",false);
        validate("society.open","{\"menu\":\"market\"}",true);
        validate("society.open","{\"menu\":\"op\"}",false);
        validate("menu.snapshot","{}",true);
        validate("menu.snapshot","{\"playerUuid\":\"other\"}",false);
        validate("menu.snapshot","[]",false);
        validate("colony.resources","{\"buildingPosition\":{\"x\":600,\"y\":64,\"z\":600},\"limit\":24}",true);
        validate("colony.resources","{\"buildingPosition\":{\"x\":600.5,\"y\":64,\"z\":600}}",false);
        validate("colony.resources","{\"buildingPosition\":{\"x\":600,\"y\":64,\"z\":600},\"limit\":25}",false);
        validate("colony.resources","{\"buildingPosition\":{\"x\":600,\"y\":64,\"z\":600,\"dimension\":\"other\"}}",false);
        String interaction="{\"position\":{\"x\":20,\"y\":64,\"z\":20},\"expectedBlockId\":\"farmersdelight:cutting_board\",\"expectedProperties\":{\"facing\":\"north\",\"waterlogged\":\"false\"},\"expectedHotbarSlot\":0,\"expectedHeldSnbt\":\"\"}";
        validate("world.interact",interaction,true);
        validate("world.interact",interaction.replace("\"false\"","false"),false);
        validate("world.interact",interaction.replace("\"expectedHotbarSlot\":0","\"expectedHotbarSlot\":9"),false);
        validate("world.interact",interaction.replace("\"expectedHeldSnbt\":\"\"","\"expectedHeldSnbt\":null"),false);
        validate("curios.state","{\"requestId\":\"forged\"}",false);
        String cutter="{\"selection\":\"group\",\"groupId\":\"domum_ornamentum:panel\",\"windowId\":1,\"expectedStateId\":0,\"expectedPosition\":{\"x\":50,\"y\":64,\"z\":20},\"expectedGroup\":null,\"expectedVariantSnbt\":\"\",\"expectedInputsSnbt\":[\"\",\"\"],\"expectedCarriedSnbt\":\"\",\"expectedOutputSnbt\":\"\"}";
        validate("domum.select",cutter,true);
        validate("domum.select",cutter.replace("\"expectedGroup\":null","\"expectedGroup\":7"),false);
        validate("domum.select",cutter.replace("\"selection\":\"group\"","\"selection\":\"variant\""),false);
        validate("domum.select",cutter.replace("\"selection\":\"group\"","\"playerUuid\":\"other\",\"selection\":\"group\""),false);
        validate("colony.setHiringMode","{\"buildingPosition\":{\"x\":600,\"y\":64,\"z\":600},\"moduleId\":1,\"expectedModuleKey\":\"a\",\"mode\":\"auto\",\"expectedMode\":\"manual\"}",true);
        validate("colony.setHiringMode","{\"buildingPosition\":{\"x\":600,\"y\":64,\"z\":600},\"moduleId\":1,\"expectedModuleKey\":\"a\",\"mode\":\"administrator\",\"expectedMode\":\"manual\"}",false);
        validate("spell.cast","{\"spellId\":\"ars_nouveau:slot_0\",\"expectedHeldSnbt\":\"real-components\",\"expectedHotbarSlot\":0}",true);
        validate("spell.cast","{\"spellId\":\"ars_nouveau:slot_0\"}",false);
        validate("spell.learnGlyph","{}",false);
        validate("spell.configure","{\"slot\":0,\"name\":\"test\",\"glyphs\":[\"ars_nouveau:glyph_self\"],\"expectedHeldSnbt\":\"book\",\"expectedHotbarSlot\":0}",true);
        validate("maid.setFollow","{\"maidUuid\":\"00000000-0000-4000-8000-000000000001\",\"follow\":true}",true);
        validate("maid.setFollow","{\"maidUuid\":\"00000000-0000-4000-8000-000000000001\",\"follow\":\"true\"}",false);
        validate("maid.status","{\"maidUuid\":\"00000000-0000-4000-8000-000000000001\",\"ownerUuid\":\"other\"}",false);
        validate("maid.openBag","{\"maidUuid\":\"../private\"}",false);
        validate("body.input","{\"keys\":[\"forward\",\"jump\"],\"durationMs\":500}",true);
        validate("body.input","{\"keys\":[\"teleport\"],\"durationMs\":500}",false);
        validate("body.input","{\"keys\":[],\"durationMs\":10001}",false);
        validate("body.input","{\"keys\":[],\"durationMs\":0}",false);
        validate("body.look","{\"yaw\":90,\"pitch\":-45,\"relative\":true}",true);
        validate("inventory.useHeld","{\"hand\":\"main\",\"expectedHotbarSlot\":0,\"expectedHeldSnbt\":\"\",\"durationMs\":1200}",true);
        String attack="{\"entityId\":1,\"expectedUuid\":\"00000000-0000-4000-8000-000000000001\",\"hand\":\"main\",\"expectedHotbarSlot\":0,\"expectedHeldSnbt\":\"\"}";
        validate("body.attack",attack,true);
        validate("body.attack",attack.replace("\"main\"","\"off\""),false);
        validate("body.attack",attack.replace("00000000-0000-4000-8000-000000000001","------------------------------------"),false);
        validate("menu.nativeClick","{\"windowId\":0,\"expectedStateId\":0,\"expectedControlHash\":\"bad\",\"slot\":9,\"button\":0,\"clickType\":\"PICKUP\"}",false);
        try{NativeModAccess.catalog("native.eval");throw new AssertionError();}catch(IllegalArgumentException expected){checks++;}
        System.out.println("NativeModAccess "+checks+" checks passed");
    }
}
