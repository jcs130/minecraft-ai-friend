package org.afuhome.agentfriend;

import java.util.*;
import java.util.function.Function;

/** Bounded, conservative walking route. Querying never moves, mines or opens anything. */
final class ObservationRoute {
    record Pos(int x, int y, int z) { }
    record Cell(boolean stand, boolean climb, boolean door, boolean known, boolean clear) { }
    record Result(String status, List<Pos> points, int visited) { }
    private record Entry(Pos pos, int cost, int score) { }
    static Result find(Pos start, Pos goal, Function<Pos, Cell> sample, int maxNodes) {
        Cell origin=sample.apply(start), end=sample.apply(goal);
        if(!origin.known()||!end.known())return new Result("unknown_endpoint",List.of(),0);
        if(!origin.stand()&&!origin.climb()||!end.stand()&&!end.climb())return new Result("unsupported_endpoint",List.of(),0);
        var open=new PriorityQueue<Entry>(Comparator.comparingInt(Entry::score));
        var costs=new HashMap<Pos,Integer>();var previous=new HashMap<Pos,Pos>();
        costs.put(start,0);open.add(new Entry(start,0,distance(start,goal)));int visited=0;
        int[][] steps={{1,0},{-1,0},{0,1},{0,-1}};
        while(!open.isEmpty()&&visited<maxNodes){
            Entry current=open.poll();Pos p=current.pos();if(costs.getOrDefault(p,Integer.MAX_VALUE)!=current.cost())continue;
            visited++;if(p.equals(goal)){
                var route=new ArrayList<Pos>();for(Pos n=p;n!=null;n=previous.get(n))route.add(n);
                Collections.reverse(route);return new Result("found",List.copyOf(route),visited);
            }
            Cell from=sample.apply(p);var next=new ArrayList<Pos>();
            for(int[] d:steps)for(int dy:new int[]{0,1,-1}){
                Pos n=new Pos(p.x()+d[0],p.y()+dy,p.z()+d[1]);Cell c=sample.apply(n);
                if(c.known()&&(c.stand()||c.climb())&&(dy!=1||sample.apply(new Pos(p.x(),p.y()+1,p.z())).clear())&&(dy!=-1||sample.apply(new Pos(n.x(),n.y()+1,n.z())).clear()))next.add(n);
            }
            // Vertical movement requires an actual continuous ladder/vine cell.
            if(from.climb())for(int dy:new int[]{1,-1}){
                Pos n=new Pos(p.x(),p.y()+dy,p.z());Cell c=sample.apply(n);
                if(c.known()&&(c.climb()||c.stand()))next.add(n);
            }
            for(Pos n:next){int cost=current.cost()+10+(n.y()!=p.y()?4:0)+(sample.apply(n).door()?5:0);
                if(cost>=costs.getOrDefault(n,Integer.MAX_VALUE))continue;costs.put(n,cost);previous.put(n,p);open.add(new Entry(n,cost,cost+distance(n,goal)));
            }
        }
        return new Result(open.isEmpty()?"no_local_route":"node_budget",List.of(),visited);
    }
    private static int distance(Pos a,Pos b){return 10*(Math.abs(a.x()-b.x())+Math.abs(a.z()-b.z()))+14*Math.abs(a.y()-b.y());}
}
