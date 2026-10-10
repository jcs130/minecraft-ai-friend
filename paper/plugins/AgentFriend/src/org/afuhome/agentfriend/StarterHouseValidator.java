package org.afuhome.agentfriend;

import java.util.*;

/** Bounded, world-independent inspection of one connected, furnished room. */
final class StarterHouseValidator {
    enum Kind { AIR, SOLID, GLASS, PANE, ROOF, DOOR, DOOR_TOP, BED, BED_HEAD, FURNITURE, UNKNOWN }
    record Pos(int x, int y, int z) { Pos at(int dx,int dy,int dz) { return new Pos(x+dx,y+dy,z+dz); } }
    interface Grid { Kind kind(Pos p); boolean placed(Pos p); }
    record Result(boolean floor, boolean walls, boolean roof, boolean window, boolean door, boolean bed,
                  boolean construction, int interior, int newBlocks, int structuralBlocks, String reason) {
        boolean ready() { return floor && walls && roof && window && door && bed && construction; }
        int progress() { return (floor?1:0)+(walls?1:0)+(roof?1:0)+(window?1:0)+(door?1:0)+(bed?1:0)+(construction?1:0); }
    }
    private static final int[][] SIDES={{1,0},{-1,0},{0,1},{0,-1}};
    private static boolean inside(Kind k) { return k==Kind.AIR || k==Kind.BED || k==Kind.BED_HEAD || k==Kind.FURNITURE; }
    private static boolean wall(Kind k) { return k==Kind.SOLID || k==Kind.GLASS || k==Kind.PANE; }
    private static boolean roof(Kind k) { return k==Kind.SOLID || k==Kind.GLASS || k==Kind.ROOF; }
    private static Result incomplete(boolean bed, int size, String reason) {
        return new Result(false,false,false,false,false,bed,false,size,0,0,reason);
    }
    static Result inspect(Grid grid, Pos seed) {
        if(seed==null || grid.kind(seed)!=Kind.BED) return incomplete(false,0,"place_complete_bed");
        Set<Pos> room=new HashSet<>(), structure=new HashSet<>();ArrayDeque<Pos> queue=new ArrayDeque<>();
        queue.add(seed);room.add(seed);
        while(!queue.isEmpty()) {
            Pos p=queue.remove();
            if(Math.abs(p.x-seed.x)>15 || Math.abs(p.z-seed.z)>15 || room.size()>225)
                return incomplete(true,room.size(),"room_open_or_over_225_cells");
            for(int[] d:SIDES) {
                Pos next=p.at(d[0],0,d[1]);Kind foot=grid.kind(next), head=grid.kind(next.at(0,1,0));
                if(foot==Kind.UNKNOWN || head==Kind.UNKNOWN) return incomplete(true,room.size(),"nearby_chunk_not_loaded");
                if(inside(foot) && head==Kind.AIR && room.add(next)) queue.add(next);
            }
        }
        Set<Pos> walk=new HashSet<>();queue.add(seed);walk.add(seed);
        while(!queue.isEmpty()) {Pos p=queue.remove();for(int[] d:SIDES) {
            Pos n=p.at(d[0],0,d[1]);if(room.contains(n) && grid.kind(n)!=Kind.FURNITURE && walk.add(n))queue.add(n);
        }}
        int minX=seed.x,maxX=seed.x,minZ=seed.z,maxZ=seed.z,solidColumns=0;
        boolean floor=true,walls=true,covered=true,window=false,door=false,bedHead=false,unknown=false;
        Set<Pos> perimeter=new HashSet<>();
        for(Pos p:room) {
            minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);
            bedHead |= grid.kind(p)==Kind.BED_HEAD;
            Kind below=grid.kind(p.at(0,-1,0));floor &= below==Kind.SOLID || below==Kind.GLASS;
            unknown |= below==Kind.UNKNOWN;structure.add(p.at(0,-1,0));
            boolean hasRoof=false;
            for(int y=2;y<=8;y++) { Pos top=p.at(0,y,0);Kind k=grid.kind(top);unknown|=k==Kind.UNKNOWN;
                if(roof(k)){hasRoof=true;structure.add(top);break;} }
            covered &= hasRoof;
            for(int[] d:SIDES) if(!room.contains(p.at(d[0],0,d[1]))) perimeter.add(p.at(d[0],0,d[1]));
        }
        Set<Pos> outside=new HashSet<>(),windows=new HashSet<>();
        for(int x=minX-2;x<=maxX+2;x++)for(int z=minZ-2;z<=maxZ+2;z++) {
            Pos p=new Pos(x,seed.y,z);
            if((x==minX-2 || x==maxX+2 || z==minZ-2 || z==maxZ+2) && grid.kind(p)==Kind.AIR && grid.kind(p.at(0,1,0))==Kind.AIR && outside.add(p))queue.add(p);
        }
        while(!queue.isEmpty()) {Pos p=queue.remove();for(int[] d:SIDES) {
            Pos n=p.at(d[0],0,d[1]);
            if(n.x<minX-2 || n.x>maxX+2 || n.z<minZ-2 || n.z>maxZ+2 || room.contains(n) || perimeter.contains(n))continue;
            if(grid.kind(n)==Kind.AIR && grid.kind(n.at(0,1,0))==Kind.AIR && outside.add(n))queue.add(n);
        }}
        for(Pos p:perimeter) {
            Kind a=grid.kind(p),b=grid.kind(p.at(0,1,0));unknown |= a==Kind.UNKNOWN || b==Kind.UNKNOWN;
            boolean portal=a==Kind.DOOR && b==Kind.DOOR_TOP;
            walls &= portal || wall(a) && wall(b);
            if(a==Kind.SOLID && b==Kind.SOLID) solidColumns++;
            boolean exterior=false;for(int[] d:SIDES)exterior|=outside.contains(p.at(d[0],0,d[1]));
            if(exterior){
                if(a==Kind.GLASS || a==Kind.PANE)windows.add(p);
                if(b==Kind.GLASS || b==Kind.PANE)windows.add(p.at(0,1,0));
            }
            window |= !windows.isEmpty();
            structure.add(p);structure.add(p.at(0,1,0));
            if(portal && grid.placed(p)) for(int[] d:SIDES) {
                Pos in=p.at(d[0],0,d[1]),out=p.at(-d[0],0,-d[1]);
                if(walk.contains(in) && outside.contains(out) && grid.kind(out)==Kind.AIR
                        && grid.kind(out.at(0,1,0))==Kind.AIR && grid.kind(out.at(0,-1,0))==Kind.SOLID) door=true;
            }
        }
        floor &= room.size()>=9 && maxX-minX>=2 && maxZ-minZ>=2;
        walls &= solidColumns>=4;
        int newBlocks=(int)structure.stream().filter(grid::placed).count();
        boolean newWindow=windows.stream().anyMatch(grid::placed);
        boolean construction=newBlocks>=12 && newBlocks*2>=structure.size() && grid.placed(seed) && newWindow;
        return new Result(floor,walls,covered,window,door,bedHead,construction,room.size(),newBlocks,structure.size(),
                unknown?"nearby_chunk_not_loaded":!floor?"need_3x3_supported_room":!walls?"close_two_block_high_walls":!covered?"cover_every_room_column":!window?"add_glass_window":!door?"add_complete_accessible_door":!bedHead?"complete_bed":!construction?"build_your_own_structure":"ready");
    }
}
