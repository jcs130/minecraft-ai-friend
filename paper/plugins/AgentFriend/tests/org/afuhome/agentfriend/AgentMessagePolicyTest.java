package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;

public final class AgentMessagePolicyTest {
    private static int checks;
    private static void check(boolean ok,String name) { checks++;if(!ok)throw new AssertionError(name); }
    public static void main(String[] args) {
        check(AgentMessagePolicy.agent("ag_NEKO"),"agent");
        check(AgentMessagePolicy.agent("AG_CorMy"),"case insensitive");
        check(!AgentMessagePolicy.agent("Not_ag_NEKO"),"not substring");
        String hello="{\"op\":\"hello\",\"protocol\":1,\"transport\":\"payload\"}";
        check(AgentMessagePolicy.hello(hello.getBytes(StandardCharsets.UTF_8)),"hello");
        for(String invalid:new String[]{"{}",hello.replace("1","2"),hello.replace("payload","chat"),hello.replace("hello","login"),"x",hello.replace("\"op\"","\"authorized\":true,\"op\"")})
            check(!AgentMessagePolicy.hello(invalid.getBytes(StandardCharsets.UTF_8)),"invalid hello "+invalid);
        check(!AgentMessagePolicy.hello(new byte[257]),"bounded handshake");
        for(String prefix:new String[]{"MC_AUTH_STATE","MC_GUIDE","MC_STATUS","MC_GUIDE_NEXT"}) {
            String input=prefix+" {\"sessionId\":\"random\",\"playerUuid\":\"uuid\",\"observedAt\":99,\"sequence\":4,\"authentication\":{\"authSessionId\":\"random\",\"status\":\"authenticated\",\"authorized\":true,\"passwordSet\":false},\"message\":\"营地地坪受保护，X=-1146..-1078、Z=-638..-567\",\"guide\":{\"x\":-1116,\"y\":64,\"z\":-600},\"nextCommand\":\"/mycli rules\"}";
            String result=AgentMessagePolicy.compact(input);
            check(!result.contains("random")&&!result.contains("observedAt")&&!result.contains("sequence")&&!result.contains("playerUuid"),prefix+" compact volatile");
            check(result.contains("X=-1146..-1078")&&result.contains("/mycli rules")&&result.contains("\"y\":64"),prefix+" preserve guidance");
            check(result.contains("\"authorized\":true")&&result.contains("\"passwordSet\":false"),prefix+" preserve auth");
            JsonObject full=AgentMessagePolicy.receipt(input);
            check(full.getAsJsonObject("data").has("sessionId")&&full.get("type").getAsString().equals(prefix),prefix+" payload full");
            check(AgentMessagePolicy.compact(result).equals(result),prefix+" idempotent");
        }
        for(String ordinary:new String[]{"<ag_A> MC_STATUS {}","[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。","Player joined the game","你受到了伤害","MC_STATUS not_json","MC_STATUS {} trailing","[私聊] A → 你: hi"}) {
            check(AgentMessagePolicy.receipt(ordinary)==null,"not a machine receipt: "+ordinary);
            check(AgentMessagePolicy.compact(ordinary).equals(ordinary),"ordinary text unchanged");
        }
        check(AgentMessagePolicy.compact("MC_REWARD {\"sessionId\":\"receipt-id\"}").contains("receipt-id"),"do not remove action idempotency IDs");
        String bare="{\"type\":\"MC_MARKET_CHECK\",\"schemaVersion\":1,\"ready\":false,\"nextAction\":\"需要弓\"}";
        JsonObject bareFrame=AgentMessagePolicy.receipt(bare);
        check(bareFrame.get("type").getAsString().equals("MC_MARKET_CHECK"),"bare market envelope type");
        check(bareFrame.getAsJsonObject("data").get("nextAction").getAsString().equals("需要弓"),"bare market guidance retained");
        check(AgentMessagePolicy.compact(bare).equals(bare),"legacy bare chat format preserved");
        for(String json:new String[]{"{\"type\":\"MC_MARKET_CHECK\"}","{\"type\":\"npc_speech\",\"schemaVersion\":1}",
                "{\"type\":\"MC_MARKET_CHECK\",\"schemaVersion\":1} trailing","{\"type\":{},\"schemaVersion\":1}"})
            check(AgentMessagePolicy.receipt(json)==null,"not a reserved bare receipt: "+json);
        check(AgentMessagePolicy.launcherWarning("/skin notification ignore-cracked-client https://skinsrestorer.net/docs/troubleshooting/launcher-issues"),"exact launcher notification");
        check(!AgentMessagePolicy.launcherWarning("SkinsRestorer API error"),"keep skin failures");
        check(AgentMessagePolicy.joinTip("[系统·技能目录] 说明"),"known unsolicited hint");
        check(!AgentMessagePolicy.joinTip("[危险] 怪物正在攻击"),"keep danger");
        for(String title:new String[]{"突袭 - 剩余2名袭击者","试炼救援 6/10秒","追踪 ag_NEKO","地下城头目"})
            check(ActivityBarBudget.label(title)==null,"unrelated bar unchanged: "+title);
        ActivityBarBudget b=new ActivityBarBudget("☾ 星灯夜巡",1,"☾ 星灯夜巡 | 3:00");int names=0,progress=0;
        for(int remaining=179;remaining>=0;remaining--){
            if(b.updateTitle("☾ 星灯夜巡 | "+remaining/60+":"+String.format("%02d",remaining%60)))names++;
            if(b.updateProgress(remaining/180f))progress++;
        }
        check(names==1,"only last-minute title update");check(progress==4,"four progress packets for full event");
        check(b.title().equals("☾ 星灯夜巡 · 最后1分钟"),"no ticking clock in title");
        check(ActivityBarBudget.quantize(.999f)==1f&&ActivityBarBudget.quantize(.75f)==.75f,"correct progress boundaries");
        check(ActivityBarBudget.quantize(0)==0&&ActivityBarBudget.quantize(2)==1,"bounded progress");
        System.out.println("PASS "+checks+" message policy checks");
    }
}
