package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskBowAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskCrossBowAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskDanmakuAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskTridentAttack;
import io.vortexcore.item.CustomItemDefinition;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.CrossbowItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.ProjectileWeaponItem;
import local.tlmcompat.hybrid.MaidGuardDecision.Mode;

/** Only the original maid's equipped item and unlocked backpack can supply a weapon. */
final class MaidGuardLoadout {
    private static final List<ResourceLocation> TASKS = List.of(TaskBowAttack.UID, TaskCrossBowAttack.UID,
        TaskDanmakuAttack.UID, TaskTridentAttack.UID, TaskAttack.UID);
    private static final Set<String> AMMUNITION = Set.of("has_arrow", "has_ammunition");

    record Weapon(Mode mode, IAttackTask task, CustomItemDefinition staff, int slot, ItemStack item) {
        String itemId() { return BuiltInRegistries.ITEM.getKey(item.getItem()).toString(); }
    }

    static List<Weapon> weapons(EntityMaid maid, NativeMaidMagicSupport magic) {
        List<Weapon> weapons = new ArrayList<>();
        var hand = maid.getMainHandItem();
        var equipped = weapon(maid, magic, hand, -1);
        if (equipped != null) weapons.add(equipped);
        var inventory = maid.getMaidInv();
        for (int slot = 0; slot < NativeMaidInventory.capacity(maid); slot++) {
            if (!NativeMaidInventory.acceptsEquipmentSwap(maid, slot, hand)) continue;
            var weapon = weapon(maid, magic, inventory.getStackInSlot(slot), slot);
            if (weapon != null) weapons.add(weapon);
        }
        return weapons;
    }

    static IAttackTask equippedNativeTask(EntityMaid maid) {
        var weapon = weapon(maid, null, maid.getMainHandItem(), -1);
        return weapon == null ? null : weapon.task;
    }

    private static Weapon weapon(EntityMaid maid, NativeMaidMagicSupport magic, ItemStack item, int slot) {
        if (item.isEmpty()) return null;
        if (magic != null) {
            var staff = magic.staff(item);
            if (staff != null) return new Weapon(Mode.MAGIC, null, staff, slot, item);
        }
        for (var id : TASKS) {
            if (!(TaskManager.getTaskMap().get(id) instanceof IAttackTask attack)
                    || !attack.isEnable(maid) || !attack.isWeapon(maid, item)) continue;
            boolean ready = slot < 0 ? ammoReady(maid, attack) : canLoad(maid, item, slot);
            if (!ready) return null;
            Mode mode = id.equals(TaskAttack.UID) ? Mode.MELEE
                : id.equals(TaskDanmakuAttack.UID) ? Mode.MAGIC : Mode.RANGED;
            return new Weapon(mode, attack, null, slot, item);
        }
        return null;
    }

    static boolean ammoReady(EntityMaid maid, IAttackTask task) {
        return task.getConditionDescription(maid).stream().filter(c -> AMMUNITION.contains(c.getFirst()))
            .allMatch(c -> c.getSecond().test(maid));
    }

    private static boolean canLoad(EntityMaid maid, ItemStack item, int weaponSlot) {
        if (!(item.getItem() instanceof ProjectileWeaponItem projectile)) return true;
        var supported = projectile.getAllSupportedProjectiles();
        var offhand = maid.getOffhandItem();
        if (supported.test(offhand) || supported.test(maid.getMainHandItem())
                || (projectile instanceof CrossbowItem && offhand.is(Items.FIREWORK_ROCKET))) return true;
        for (int slot = 0; slot < NativeMaidInventory.capacity(maid); slot++)
            if (slot != weaponSlot && supported.test(maid.getMaidInv().getStackInSlot(slot))) return true;
        return false;
    }
}
