package org.qiandeng.observer;

import java.lang.reflect.Method;
import java.util.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.InteractionHand;

/** Public render state only. Caller supplies entities already tracked by this
 * exact viewer; no world scan, inventory, owner, dialogue or AI memory export. */
final class MaidObservation {
    private static final Map<Class<?>, Map<String, Method>> METHODS = new HashMap<>();
    private static Object read(Object target, String name) throws ReflectiveOperationException {
        var methods = METHODS.computeIfAbsent(target.getClass(), ignored -> new HashMap<>());
        var method = methods.get(name);
        if (method == null) { method = target.getClass().getMethod(name); methods.put(name, method); }
        return method.invoke(target);
    }
    static Map<String, Object> capture(Entity entity) {
        if (!BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString().equals("touhou_little_maid:maid") ||
            !(entity instanceof LivingEntity living)) return null;
        Map<String,Object> row = new LinkedHashMap<>();
        row.put("uuid", entity.getUUID().toString()); row.put("entityId", entity.getId());
        row.put("type", "touhou_little_maid:maid");
        row.put("sampledAt", System.currentTimeMillis());
        try {
            String model = (String) read(entity, "getModelId");
            if (model.length() > 256 || !model.matches("[a-z0-9_.-]+:[a-z0-9_./-]+") || model.contains("..")) return null;
            row.put("modelId", model); boolean ysm = Boolean.TRUE.equals(read(entity, "isYsmModel")); row.put("ysm", ysm);
            if (ysm) {
                String ysmModel = (String) read(entity, "getYsmModelId"), texture = (String) read(entity, "getYsmModelTexture");
                // Visible appearance selection only, never owner/history/inventory.
                if (!visualChoice(ysmModel) || !visualChoice(texture)) throw new ReflectiveOperationException("Invalid YSM selection");
                row.put("ysmModelId", ysmModel); row.put("ysmTexture", texture);
            }
            row.put("sitting", read(entity, "isMaidInSittingPose")); row.put("begging", read(entity, "isBegging"));
            row.put("armRise", read(entity, "isSwingingArms"));
            row.put("task", read(read(entity, "getTask"), "getUid").toString());
            row.put("backpack", read(read(entity, "getMaidBackpackType"), "getId").toString());
            row.put("sleeping", living.isSleeping()); row.put("passenger", entity.isPassenger());
            row.put("baby", living.isBaby()); row.put("inWater", entity.isInWater());
            row.put("usingItem", living.isUsingItem()); row.put("offhandUse", living.getUsedItemHand() == InteractionHand.OFF_HAND);
            row.put("offhandSwing", living.swingingArm == InteractionHand.OFF_HAND);
            row.put("hasMainHand", !living.getMainHandItem().isEmpty());
            row.put("hasHelmet", !living.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.HEAD).isEmpty());
            row.put("hasChestPlate", !living.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.CHEST).isEmpty());
            row.put("hasLeggings", !living.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.LEGS).isEmpty());
            row.put("hasBoots", !living.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.FEET).isEmpty());
            row.put("attackAnim", living.getAttackAnim(1)); row.put("swingTime", living.swingTime);
            row.put("hurtTime", living.hurtTime); row.put("health", living.getHealth());
            row.put("maxHealth", living.getMaxHealth()); row.put("onGround", entity.onGround()); row.put("sprinting", entity.isSprinting());
            row.put("bodyYaw", living.yBodyRot); row.put("headYaw", living.yHeadRot);
            row.put("pitch", entity.getXRot()); row.put("ageTicks", entity.tickCount);
            row.put("available", true);
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            row.put("available", false); row.put("reason", "TLM_NATIVE_STATE_UNAVAILABLE");
        }
        return row;
    }
    private static boolean visualChoice(String value) {
        return value != null && !value.isEmpty() && value.length() <= 96 && !value.startsWith("/") && !value.contains("..") &&
            value.matches("[-\\p{L}\\p{N}_./]+");
    }
}
