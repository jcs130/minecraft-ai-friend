package dev.qiandeng.maw.saoforge;

/** Pure migration decision: never move unauthenticated players or established homes. */
public final class ArrivalPolicy {
    public record Bounds(int x1,int y1,int z1,int x2,int y2,int z2){
        public Bounds{if(x2<x1||y2<y1||z2<z1||(long)x2-x1>64||(long)y2-y1>64||(long)z2-z1>64)throw new IllegalArgumentException("arrival_bounds");}
        public boolean contains(double x,double y,double z){return x>=x1&&x<(double)x2+1&&y>=y1&&y<(double)y2+1&&z>=z1&&z<(double)z2+1;}
    }
    public enum Decision { WAIT, MOVE, KEEP }
    public static Decision decide(boolean authenticated,boolean alive,boolean listed,boolean handled,String dimension,String legacyDimension,Bounds bounds,double x,double y,double z){
        if(!authenticated||!alive||!listed||handled)return Decision.WAIT;
        return dimension.equals(legacyDimension)&&bounds.contains(x,y,z)?Decision.MOVE:Decision.KEEP;
    }
    private ArrivalPolicy(){}
}
