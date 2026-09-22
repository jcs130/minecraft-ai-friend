package dev.qiandeng.irons;

public final class TownCommandScopeTest {
    private static int checks;
    private static void check(boolean value) { checks++; if(!value)throw new AssertionError("command scope "+checks); }
    public static void main(String[] args) throws Exception {
        check(!TownCommandScope.active());
        for(boolean entity:new boolean[]{false,true})for(boolean permission:new boolean[]{false,true}){
            int result=TownCommandScope.call(entity,permission,()->{check(TownCommandScope.active()==(!entity&&permission));return 7;});
            check(result==7);check(!TownCommandScope.active());
        }
        TownCommandScope.call(false,true,()->{
            check(TownCommandScope.active());
            TownCommandScope.call(true,true,()->{check(!TownCommandScope.active());return null;});
            check(TownCommandScope.active());return null;
        });
        check(!TownCommandScope.active());
        var failure=new IllegalStateException("expected");
        try{TownCommandScope.call(false,true,()->{throw failure;});throw new AssertionError("expected failure");}
        catch(IllegalStateException caught){check(caught==failure);}
        check(!TownCommandScope.active());
        Runnable later=TownCommandScope.call(false,true,()->(Runnable)()->check(!TownCommandScope.active()));later.run();
        var crossThread=new java.util.concurrent.atomic.AtomicBoolean(true);
        TownCommandScope.call(false,true,()->{
            Thread t=new Thread(()->crossThread.set(TownCommandScope.active()));t.start();
            try{t.join();}catch(InterruptedException e){throw new RuntimeException(e);}return null;
        });
        check(!crossThread.get());check(!TownCommandScope.active());
        System.out.println("{\"ok\":true,\"suite\":\"town_command_scope\",\"checks\":"+checks+"}");
    }
}
