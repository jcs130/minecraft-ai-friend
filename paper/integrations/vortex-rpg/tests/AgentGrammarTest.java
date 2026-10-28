import org.qiandengji.vortex.BridgeRules;
import java.util.*;

public final class AgentGrammarTest {
    static int checks;
    static void check(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    static BridgeRules.Request parse(String text){return BridgeRules.parse(text.isEmpty()?new String[0]:text.split(" +"));}
    static void invalid(String text,String next){try{parse(text);throw new AssertionError("accepted "+text);}catch(IllegalArgumentException e){check(e.getMessage().contains("invalid_argument")&&e.getMessage().contains("未执行")&&e.getMessage().contains(next),text);}}
    public static void main(String[] args){
        check(parse("").group().equals("status"),"root query");
        for(String group:List.of("profession","class","skills","spells","tasks","quests"))check(parse(group).action().equals("status"),"bare safe query "+group);
        for(String action:List.of("choose knight","learn knight_guard","prepare fortify","accept first_blood","claim first_blood")){
            String group=action.startsWith("choose")?"profession":action.startsWith("learn")||action.startsWith("prepare")?"skills":"tasks";
            var a=parse(group+" "+action);var b=parse("--json "+group+" "+action);check(a.group().equals(b.group())&&a.action().equals(b.action())&&a.arguments().equals(b.arguments())&&b.json(),"format only "+action);
        }
        for(String line:List.of("profession choose knight --help","skills learn knight_guard -h","tasks claim first_blood --help"))check(parse(line).help(),"help cannot execute "+line);
        for(String line:List.of("profession choose","profession choose knight extra","profession menu knight","skills learn","skills prepare fortify extra","skills learn knight_guard --page 1","tasks accept first_blood --page 2","tasks status first_blood --page 1","cast fortify extra","skills list unknown"))invalid(line,"/mycli");
        invalid("skills upgrade fortify","/mycli skills --help");invalid("tasks xyz","/mycli tasks --help");invalid("cast","/mycli skills list");
        for(String page:List.of("0","-1","x","2147483648"))invalid("tasks list --page "+page,"/mycli --help");
        invalid("tasks list --page 1 --page 2","/mycli --help");invalid("tasks list --page","/mycli --help");invalid("tasks list -x","/mycli --help");
        check(parse("tasks status first_blood").arguments().equals(List.of("first_blood")),"focused progress");
        var all=java.util.stream.IntStream.range(0,15).boxed().toList();var found=new ArrayList<Integer>();
        for(int page=1;page<=3;page++){var r=parse("--json tasks list --page "+page);var rows=BridgeRules.page(all,r);check(rows.size()<=7,"bounded page");found.addAll(rows);if(page<3)check(BridgeRules.pagination(15,r).get("nextCommand").equals("/mycli tasks list --page "+(page+1)+" --json"),"copyable next page");}
        check(found.equals(all),"no lost or duplicate rows");check(BridgeRules.page(List.of(),parse("tasks status")).isEmpty(),"empty state succeeds");
        try{BridgeRules.page(all,parse("tasks list --page 4"));throw new AssertionError();}catch(IllegalArgumentException e){check(e.getMessage().contains("1–3"),"range recovery");}
        System.out.println("grammar="+checks);
    }
}
