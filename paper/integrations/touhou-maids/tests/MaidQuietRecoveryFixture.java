package local.tlmcompat.hybrid;
import java.util.UUID;

/** Same behavioral assertion against the deployed API and its replacement. */
public final class MaidQuietRecoveryFixture {
    static boolean admitted(MaidConversationWindow w,UUID actor,UUID maid,UUID world,Object session,long now)throws Exception{
        try{return (boolean)w.getClass().getDeclaredMethod("allow",UUID.class,UUID.class,UUID.class,Object.class,String.class,long.class)
            .invoke(w,actor,maid,world,session,"前面怎么走",now);}
        catch(NoSuchMethodException revised){
            Object result=w.getClass().getDeclaredMethod("admit",UUID.class,UUID.class,UUID.class,Object.class,String.class,boolean.class,long.class)
                .invoke(w,actor,maid,world,session,"前面怎么走",true,now);
            return (boolean)result.getClass().getDeclaredMethod("allowed").invoke(result);
        }
    }
    public static void main(String[] args)throws Exception{
        MaidConversationWindow w=new MaidConversationWindow();UUID a=UUID.randomUUID(),m=UUID.randomUUID(),world=UUID.randomUUID();Object session=new Object();
        for(int i=0;i<6;i++){w.started(a,m,world,session,i);w.replied(a,m,world,session,"一起看看",false,i);}
        for(long t:new long[]{31,61,91})if(admitted(w,a,m,world,session,t*1_000_000_000L))throw new AssertionError("quiet period must hold");
        if(!admitted(w,a,m,world,session,121_000_000_000L))throw new AssertionError("repeated named requests incorrectly extend silence");
        System.out.println("PASS fixed quiet deadline recovers despite repeated named requests");
    }
}
