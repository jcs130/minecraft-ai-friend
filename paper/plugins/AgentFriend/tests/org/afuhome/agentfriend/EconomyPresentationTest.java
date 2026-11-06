package org.afuhome.agentfriend;
import com.google.gson.*;

/** Exercise the same receipt formatter as both command and container paths. */
public final class EconomyPresentationTest {
    private static int checks;
    private static void check(boolean v,String why){if(!v)throw new AssertionError(why);checks++;}
    private static JsonObject read(String s){return JsonParser.parseString(s).getAsJsonObject();}
    public static void main(String[]args){
        JsonObject r=read("{\"action\":\"quote\",\"success\":true,\"quantity\":1,\"price\":9,\"quoteId\":\"qa-quote\",\"item\":{\"name\":\"铁剑\",\"serializedItemBase64\":\"DO_NOT_PRINT_COMPONENTS\"}}");
        String s=EconomyPresentation.text(r);check(s.contains("尚未卖出")&&s.contains("30秒"),"quote is not a sale");
        check(s.contains("/mycli trade recycle sell qa-quote"),"quote supplies exact next command");
        check(!s.contains("DO_NOT_PRINT")&&!s.contains("serializedItem"),"text does not flood context with binary components");
        r=read("{\"action\":\"buy\",\"success\":false,\"reason\":\"money_unverified\",\"balance\":null}");
        s=EconomyPresentation.text(r);check(s.contains("待对账")&&!s.contains("购买成功"),"unknown bank outcome never becomes success");
        check(s.contains("不重复")&&s.contains("trade recycle status"),"uncertain mutation must not be replayed");
        r=read("{\"action\":\"wallet\",\"success\":true,\"balance\":null}");
        check(EconomyPresentation.text(r).contains("暂不可用"),"unknown balance is not zero");
        r.addProperty("balance",125.25);check(EconomyPresentation.text(r).contains("125.25"),"fractional bank balance survives rendering");
        for(String reason:new String[]{"insufficient_balance","quote_expired","quote_unknown_or_consumed","item_changed","not_recyclable_or_protected","invalid_offer_or_quantity","pending_queue_full","economy_unavailable"}){
            r=read("{\"action\":\"buy\",\"success\":false}");r.addProperty("reason",reason);
            s=EconomyPresentation.text(r);check(s.contains("/mycli "),reason+" gives a real next command");
        }
        r=read("{\"action\":\"buy\",\"success\":true,\"quantity\":32,\"spent\":4,\"balance\":8,\"pending\":true,\"item\":{\"name\":\"火把\"}}");
        s=EconomyPresentation.text(r);check(s.contains("火把 ×32")&&s.contains("已扣 4"),"receipt retains true quantities and cost");
        check(s.contains("待入箱")&&s.contains("stash page 1")&&s.contains("不要重复购买"),"delivery explains where items went");
        r=read("{\"action\":\"recycle_status\",\"success\":true,\"balance\":10,\"pending\":true}");
        check(EconomyPresentation.text(r).contains("不要重复买卖"),"pending flag matters even when status read succeeds");
        check(EconomyPresentation.complete(new String[]{"trade","rec"}).equals(java.util.List.of("recycle")),"completion discovers the existing trade branch");
        check(EconomyPresentation.complete(new String[]{"trade","recycle","quote","c"}).equals(java.util.List.of("chest")),"completion supplies a valid source");
        check(EconomyPresentation.complete(new String[]{"inventory","status"})==null,"unrelated completion remains unchanged");
        System.out.println("PASS "+checks+" economy presentation assertions");
    }
}
