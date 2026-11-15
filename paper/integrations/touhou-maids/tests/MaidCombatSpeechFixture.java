package local.tlmcompat.hybrid;

public final class MaidCombatSpeechFixture {
    static int count;
    static void check(boolean ok, String label) { count++; if (!ok) throw new AssertionError(label); }
    public static void main(String[] args) {
        long s=1_000_000_000L;var policy=new MaidCombatSpeech();
        check(policy.hit(0,0,"MAGIC",true,false)==null,"blocked damage is silent");
        check(policy.hit(0,Float.NaN,"MAGIC",true,false)==null,"invalid damage is silent");
        check(policy.hit(0,1,"MAGIC",false,false)==null,"no unattended voice generation");
        check(policy.hit(0,1,"MAGIC",true,true)==null,"reply has priority");
        String first=policy.hit(0,1,"MAGIC",true,false);
        check(first!=null&&first.contains("命中"),"actual magic hit can react");
        check(policy.hit(s,1,"RANGED",true,false)==null,"changing weapons cannot bypass shared gap");
        check(policy.hit(29*s,1,"MELEE",true,false)==null,"every tick cannot produce speech");
        check(policy.hit(30*s,1,"RANGED",true,true)==null,"busy gap end remains silent");
        String next=policy.hit(31*s,1,"RANGED",true,false);
        check(next!=null&&!next.equals(first),"busy skip does not consume next opportunity");
        check(policy.hit(61*s,1,"MELEE",true,false)!=null,"melee is supported");
        for(String mode:new String[]{"MELEE","RANGED","MAGIC"})for(int i=0;i<4;i++){
            String line=policy.hit((100+i*30+(mode.equals("MELEE")?0:mode.equals("RANGED")?200:400))*s,2,mode,true,false);
            check(line!=null&&line.length()<=15&&!line.contains("主人")&&!line.contains("击杀"),"short partner voice never invents a kill");
        }
        check(MaidCombatSpeech.fresh(0,12*s),"bounded in-scene preparation time");
        check(!MaidCombatSpeech.fresh(0,13*s),"stale synthesis is discarded");
        check(MaidCombatSpeech.lowPriority("combat")&&MaidCombatSpeech.lowPriority("ambient")&&!MaidCombatSpeech.lowPriority("reply"),"reply preempts combat and ambience");
        System.out.println("PASS "+count+" combat speech checks");
    }
}
