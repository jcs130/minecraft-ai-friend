package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Navigation metadata, deliberately outside Site's persisted combat definition. */
record DungeonEntrance(List<Integer> entry, String hint, Station station) {
    record Station(String name, List<Integer> board, List<Integer> button, List<Integer> bounds,
                   Map<String,List<Integer>> facilities) {
        private static final Set<String> FACILITIES=Set.of("craftingTable","furnace","anvil","sharedChest","sharedChestOtherHalf");
        static Station parse(Map<String,?> raw, List<Integer> entry, int minHeight, int maxHeight) {
            var keys=new HashSet<>(raw.keySet());
            keys.remove("facilities");
            if (!keys.equals(Set.of("name","board","button","bounds")))
                throw new IllegalArgumentException("invalid_station_fields");
            if (!(raw.get("name") instanceof String name) || name.isBlank() || name.length() > 30)
                throw new IllegalArgumentException("invalid_station_name");
            var board = integers(raw.get("board"),3);
            var button = integers(raw.get("button"),3);
            var bounds = integers(raw.get("bounds"),6);
            Map<String,List<Integer>> facilities=new LinkedHashMap<>();
            if (raw.containsKey("facilities")) {
                if (!(raw.get("facilities") instanceof Map<?,?> points) || !points.keySet().equals(FACILITIES))
                    throw new IllegalArgumentException("invalid_station_facilities");
                for (String key : FACILITIES) facilities.put(key,integers(points.get(key),3));
            }
            var station = new Station(name,board,button,bounds,Map.copyOf(facilities));
            for (int axis=0;axis<3;axis++) {
                long extent=(long) bounds.get(axis+3)-bounds.get(axis);
                if (extent<0 || extent>48) throw new IllegalArgumentException("station_bounds");
            }
            if (bounds.get(1)<minHeight || bounds.get(4)>=maxHeight
                    || !station.covers(entry) || !station.covers(board) || !station.covers(button)
                    || Math.abs((long) button.get(1)-entry.get(1))>3)
                throw new IllegalArgumentException("station_points_outside");
            var used=new HashSet<>(List.of(entry,board,button));
            for (var at : facilities.values()) {
                if (!station.covers(at) || at.get(1).intValue()!=entry.get(1) || !used.add(at))
                    throw new IllegalArgumentException("station_facility_position");
            }
            if (!facilities.isEmpty()) {
                var left=facilities.get("sharedChest");
                var right=facilities.get("sharedChestOtherHalf");
                if (Math.abs(left.get(0)-right.get(0))+Math.abs(left.get(2)-right.get(2))!=1)
                    throw new IllegalArgumentException("station_double_chest");
            }
            return station;
        }
        boolean covers(List<Integer> point) {
            return contains(point.get(0),point.get(1),point.get(2));
        }
        boolean contains(int x,int y,int z) {
            return x>=bounds.get(0)&&x<=bounds.get(3)&&y>=bounds.get(1)&&y<=bounds.get(4)
                    &&z>=bounds.get(2)&&z<=bounds.get(5);
        }
        boolean protectedBy(List<int[]> boxes) {
            return boxes.stream().anyMatch(b -> {
                for (int i=0;i<3;i++) if (b[i]>bounds.get(i)||b[i+3]<bounds.get(i+3)) return false;
                return true;
            });
        }
        boolean isPublicStorage(List<Integer> position,boolean furnace) {
            if(furnace)return position.equals(facilities.get("furnace"));
            return position.equals(facilities.get("sharedChest"))||position.equals(facilities.get("sharedChestOtherHalf"));
        }
    }

    static DungeonEntrance parse(Object raw, String hint, int minHeight, int maxHeight,
                                 int firstX, int firstY, int firstZ) {
        return parse(raw,hint,null,minHeight,maxHeight,firstX,firstY,firstZ);
    }

    private static List<Integer> integers(Object raw,int count) {
        if (!(raw instanceof List<?> values) || values.size()!=count)
            throw new IllegalArgumentException("invalid_approach_coordinate_list");
        List<Integer> point = new ArrayList<>();
        for (Object value : values) {
            if (!(value instanceof Number n) || n.doubleValue() != n.intValue())
                throw new IllegalArgumentException("integer_approach_entry_required");
            point.add(n.intValue());
        }
        return List.copyOf(point);
    }

    static DungeonEntrance groundStation(Object raw, String hint, Map<String,?> station, int minHeight, int maxHeight) {
        var entry=integers(raw,3);
        if (Math.abs((long)entry.get(0))>=29_000_000 || Math.abs((long)entry.get(2))>=29_000_000
                || entry.get(1)<=minHeight || entry.get(1)+1>=maxHeight)
            throw new IllegalArgumentException("ground_station_entry_bounds");
        if (hint==null || hint.isBlank() || hint.length()>300)
            throw new IllegalArgumentException("approach_hint_required_limit_300");
        var platform=Station.parse(station,entry,minHeight,maxHeight);
        int y=entry.get(1);
        if (!platform.contains(entry.get(0),y-1,entry.get(2)) || !platform.contains(entry.get(0),y+1,entry.get(2)))
            throw new IllegalArgumentException("ground_station_landing_unprotected");
        return new DungeonEntrance(entry,hint.strip(),platform);
    }

    static DungeonEntrance parse(Object raw,String hint,Map<String,?> station,int minHeight,int maxHeight,
                                 int firstX,int firstY,int firstZ) {
        if(!(raw instanceof List<?> values)||values.size()!=3)
            throw new IllegalArgumentException("invalid_approach_entry");
        var point=integers(raw,3);
        int x = point.get(0), y = point.get(1), z = point.get(2);
        if (Math.abs((long) x) >= 29_000_000 || Math.abs((long) z) >= 29_000_000
                || y <= minHeight || y + 1 >= maxHeight
                || Math.abs((long) x - firstX) > 256 || Math.abs((long) z - firstZ) > 256
                || Math.abs((long) y - firstY) > (station==null?128:256))
            throw new IllegalArgumentException("approach_entry_bounds");
        if (hint == null || hint.isBlank() || hint.length() > 300)
            throw new IllegalArgumentException("approach_hint_required_limit_300");
        return new DungeonEntrance(point,hint.strip(),station==null?null:Station.parse(station,point,minHeight,maxHeight));
    }

    /** Require the floor, feet and head in explicitly declared building protection. */
    boolean protectedBy(List<int[]> boxes) {
        int x = entry.get(0), y = entry.get(1), z = entry.get(2);
        for (int dy = -1; dy <= 1; dy++) {
            final int atY = y + dy;
            if (boxes.stream().noneMatch(b -> x >= b[0] && x <= b[3]
                    && atY >= b[1] && atY <= b[4] && z >= b[2] && z <= b[5])) return false;
        }
        return true;
    }
}
