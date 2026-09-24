package com.dwinovo.numen.core.gametest;

import com.dwinovo.numen.core.combat.Menace;
import com.dwinovo.numen.core.task.chain.MobDefenseChain;
import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.NumenPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.gametest.framework.BeforeBatch;
import net.minecraft.gametest.framework.AfterBatch;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.Difficulty;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.gametest.GameTestHolder;
import net.neoforged.neoforge.gametest.PrefixGameTestTemplate;
import java.util.UUID;

/** Real server tick/pathing tests; creates only fresh GameTest bodies in its isolated world. */
@GameTestHolder("numen")
@PrefixGameTestTemplate(false)
public final class DefenseGameTests {
    private static Difficulty previousDifficulty;

    @BeforeBatch(batch="numen_defense")
    public static void keepTheShooterAlive(ServerLevel level) {
        previousDifficulty=level.getDifficulty();
        level.getServer().setDifficulty(Difficulty.NORMAL,true);
    }

    @AfterBatch(batch="numen_defense")
    public static void restoreDifficulty(ServerLevel level) {
        level.getServer().setDifficulty(previousDifficulty,true);
    }

    @GameTest(template="floor52", timeoutTicks=600, batch="numen_defense")
    public static void named_ranged_attacker_makes_idle_body_retreat(GameTestHelper helper) {
        var level=helper.getLevel();
        BlockPos pos=helper.absolutePos(new BlockPos(24,2,24));
        NumenPlayer body=CompanionFactory.spawn(level.getServer(),UUID.randomUUID(),
                "gametest_defense",UUID.randomUUID(),level,
                new Vec3(pos.getX()+.5,pos.getY(),pos.getZ()+.5));
        body.getFoodData().setFoodLevel(20);
        var skeleton=EntityType.SKELETON.create(level);
        helper.assertTrue(skeleton!=null,"skeleton missing");
        skeleton.moveTo(body.getX()+8,body.getY(),body.getZ(),0,0);
        skeleton.setCustomName(Component.literal("protected shooter"));
        skeleton.setItemSlot(net.minecraft.world.entity.EquipmentSlot.HEAD,
                new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND_HELMET));
        skeleton.setNoAi(true);
        skeleton.setTarget(body);
        level.addFreshEntity(skeleton);
        body.hurt(level.damageSources().mobAttack(skeleton),1);
        helper.assertTrue(new MobDefenseChain().canRun(body),"ranged danger was ignored");
        Vec3 start=body.position();
        float enemyHp=skeleton.getHealth();
        long[] clearedAt={-1};
        helper.succeedWhen(()->{
            helper.assertTrue(body.isAlive(),"body died");
            helper.assertTrue(skeleton.getHealth()==enemyHp,"protected shooter was attacked");
            helper.assertTrue(!body.reflexPaused(MobDefenseChain.ID),"reflex paused itself");
            if(clearedAt[0]<0){
                helper.assertTrue(skeleton.isAlive() && !skeleton.isRemoved(),
                        "fixture shooter disappeared; difficulty="+level.getDifficulty());
                helper.assertTrue(body.position().distanceToSqr(start)>4,"body has not moved two blocks");
                helper.assertTrue(body.distanceTo(skeleton)>10,"body did not retreat away from shooter");
                skeleton.discard();
                clearedAt[0]=level.getGameTime();
            }
            helper.assertTrue(level.getGameTime()-clearedAt[0]>3,"waiting for reflex release");
            helper.assertTrue(Menace.defenseThreats(body,32).isEmpty(),"removed attacker still held body");
            CompanionFactory.despawn(level.getServer(),body);
        });
    }
}
