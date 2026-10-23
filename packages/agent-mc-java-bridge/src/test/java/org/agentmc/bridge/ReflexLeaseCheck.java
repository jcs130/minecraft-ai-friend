package org.agentmc.bridge;
public final class ReflexLeaseCheck {
    private static void check(boolean v,String why){if(!v)throw new AssertionError(why);}
    private static void reject(Runnable f,String why){try{f.run();throw new AssertionError(why);}catch(IllegalArgumentException|IllegalStateException expected){}}
    public static void main(String[] args){
        ReflexLease l=new ReflexLease();check(l.accept("kernel:1",1,7,100,100,"A",400),"fresh control accepted");
        check(!l.accept("kernel:1",1,7,100,150,"A",400),"duplicate is observed without renewing or dispatching");
        reject(()->l.accept("kernel:1",1,7,150,150,"changed",400),"same sequence changed payload");
        reject(()->l.accept("other",1,7,150,150,"A",400),"other active stream");
        check(l.active(499,7)&&!l.active(500,7),"hard input expiry");
        check(!l.active(200,8),"generation change invalidates control");
        l.clear();reject(()->l.accept("kernel:1",1,7,510,510,"A",400),"ended input cannot be revived");
        check(l.accept("kernel:1",2,7,510,510,"B",400),"fresh higher sequence after release");
        reject(()->l.accept("kernel:1",3,7,0,1000,"C",400),"old body sample");
        reject(()->l.accept("kernel:1",3,7,1000,1000,"C",401),"unbounded lease");
        check(l.accept("kernel:1",1,8,1000,1000,"new-connection",400),"new connection has an isolated stream scope");
        System.out.println("ReflexLeaseCheck: expiry, generation, exact deduplication, no revival, sample age and bounds passed");
    }
}
