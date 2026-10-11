package org.afuhome.agentfriend;
import java.util.*;
import java.util.function.Function;
public final class ObservationRouteTest {
    private static int checks;
    private static void check(String name,boolean ok){if(!ok)throw new AssertionError(name);checks++;}
    private static ObservationRoute.Cell floor(){return new ObservationRoute.Cell(true,false,false,true,true);}
    private static ObservationRoute.Cell wall(){return new ObservationRoute.Cell(false,false,false,true,false);}
    public static void main(String[] ignored){
        var a=new ObservationRoute.Pos(0,1,0);var b=new ObservationRoute.Pos(4,1,0);
        Function<ObservationRoute.Pos,ObservationRoute.Cell> flat=p->Math.abs(p.x())<=8&&Math.abs(p.z())<=8&&p.y()==1?floor():wall();
        var route=ObservationRoute.find(a,b,flat,100);check("flat route reaches endpoint",route.status().equals("found")&&route.points().getLast().equals(b));
        check("start and endpoint preserved",route.points().getFirst().equals(a)&&route.points().size()==5);
        Function<ObservationRoute.Pos,ObservationRoute.Cell> detour=p->p.x()==2&&p.z()==0?wall():flat.apply(p);
        route=ObservationRoute.find(a,b,detour,200);check("walks around wall without mining",route.status().equals("found")&&route.points().stream().noneMatch(p->p.x()==2&&p.z()==0));
        check("bounded node exhaustion not false absence",ObservationRoute.find(a,b,detour,1).status().equals("node_budget"));
        check("unknown endpoint not empty world",ObservationRoute.find(a,b,p->new ObservationRoute.Cell(false,false,false,false,false),100).status().equals("unknown_endpoint"));
        check("unsupported endpoint explicit",ObservationRoute.find(a,b,p->wall(),100).status().equals("unsupported_endpoint"));
        Function<ObservationRoute.Pos,ObservationRoute.Cell> ladder=p->p.x()!=0||p.z()!=0||p.y()<1||p.y()>5?wall():new ObservationRoute.Cell(p.y()==1||p.y()==5,p.y()<5,false,true,true);
        route=ObservationRoute.find(a,new ObservationRoute.Pos(0,5,0),ladder,20);check("real continuous ladder climbs",route.status().equals("found")&&route.points().size()==5);
        Function<ObservationRoute.Pos,ObservationRoute.Cell> broken=p->p.y()==3?wall():ladder.apply(p);
        check("broken ladder not magic levitation",!ObservationRoute.find(a,new ObservationRoute.Pos(0,5,0),broken,20).status().equals("found"));
        Function<ObservationRoute.Pos,ObservationRoute.Cell> step=p->{if(p.z()!=0||p.x()<0||p.x()>1)return wall();if(p.x()==0&&p.y()==1||p.x()==1&&p.y()==2)return floor();return p.x()==0&&p.y()==2?new ObservationRoute.Cell(false,false,false,true,true):wall();};
        check("one-block step with headroom",ObservationRoute.find(a,new ObservationRoute.Pos(1,2,0),step,20).status().equals("found"));
        check("low ceiling prevents jump",!ObservationRoute.find(a,new ObservationRoute.Pos(1,2,0),p->p.equals(new ObservationRoute.Pos(0,2,0))?wall():step.apply(p),20).status().equals("found"));
        Function<ObservationRoute.Pos,ObservationRoute.Cell> door=p->p.equals(new ObservationRoute.Pos(2,1,0))?new ObservationRoute.Cell(true,false,true,true,true):flat.apply(p);
        check("openable door yields route hint",ObservationRoute.find(a,b,door,100).status().equals("found"));
        check("missing floor is not traversed",!ObservationRoute.find(a,b,p->p.x()==2?wall():flat.apply(p),200).status().equals("found"));
        System.out.println("ObservationRoute checks="+checks);
    }
}
