package org.afuhome.agentfriend;

import java.util.*;

/** Pure block authorization geometry. Inclusive village edges remain protected. */
final class BlockAccessRules {
    static final int LIMIT = 29_999_984;
    record Area(String world, int minX, int minZ, int maxX, int maxZ) {
        Area {
            if (world == null || world.isBlank() || minX > maxX || minZ > maxZ
                    || minX < -LIMIT || maxX > LIMIT || minZ < -LIMIT || maxZ > LIMIT)
                throw new IllegalArgumentException("村庄范围需要有效世界名和含边界的 X/Z 整数范围");
        }
        boolean contains(String w, int x, int z) {
            return world.equals(w) && x >= minX && x <= maxX && z >= minZ && z <= maxZ;
        }
    }
    final boolean enabled;
    final Set<UUID> editors;
    final List<Area> villages;
    BlockAccessRules(boolean enabled, Set<UUID> editors, List<Area> villages) {
        if (enabled && villages.isEmpty()) throw new IllegalArgumentException("启用时必须明确至少一个保留保护的村庄");
        // Retained areas also include authored adventure worlds. The eight
        // existing village/facility areas must not be removed to fit a map.
        // Keep the independent 256-region complement bound below.
        if (villages.size() > 16 || editors.size() > 16) throw new IllegalArgumentException("最多16个保留保护区域、16位建设者");
        this.enabled = enabled;
        this.editors = Set.copyOf(editors);
        this.villages = List.copyOf(villages);
    }
    boolean open(UUID player, String world, int x, int z) {
        return enabled && (editors.contains(player) || villages.stream().noneMatch(a -> a.contains(world, x, z)));
    }
    static boolean blockAction(String action) {
        return Set.of("break", "place", "harvest", "damage", "bucket", "fertilize").contains(action);
    }
    /** Exact complement, without covering any retained village or loading chunks. */
    List<Area> outside(String world) {
        List<Area> retained = villages.stream().filter(a -> a.world.equals(world)).toList();
        TreeSet<Integer> cuts = new TreeSet<>(List.of(-LIMIT, LIMIT + 1));
        for (Area a : retained) { cuts.add(a.minX); cuts.add(a.maxX + 1); }
        List<Integer> xs = new ArrayList<>(cuts);
        List<Area> result = new ArrayList<>();
        for (int i = 1; i < xs.size(); i++) {
            int left = xs.get(i - 1), right = xs.get(i) - 1;
            List<Area> blocked = retained.stream().filter(a -> left <= a.maxX && right >= a.minX)
                    .sorted(Comparator.comparingInt(Area::minZ)).toList();
            int z = -LIMIT;
            for (Area a : blocked) {
                if (a.minZ > z) result.add(new Area(world, left, z, right, a.minZ - 1));
                z = Math.max(z, a.maxZ + 1);
            }
            if (z <= LIMIT) result.add(new Area(world, left, z, right, LIMIT));
        }
        if (result.size() > 256) throw new IllegalArgumentException("村庄划分过于复杂，最多256个开放区域");
        return List.copyOf(result);
    }
}
