package com.dwinovo.numen.core.task.chain;

import com.dwinovo.numen.core.combat.Menace;
import com.dwinovo.numen.core.task.combat.AttackCompanionTask;
import com.dwinovo.numen.core.task.combat.AttackTaskRecord;
import com.dwinovo.numen.core.task.survival.SurvivalDecisions;
import com.dwinovo.numen.entity.InputDriver;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.task.Task;
import com.dwinovo.numen.task.TaskState;
import com.dwinovo.numen.task.reflex.Reflex;

import net.minecraft.world.entity.LivingEntity;

import java.util.ArrayList;
import java.util.List;

/**
 * 危险来了自动自卫,复用 {@link AttackCompanionTask} 的战斗或撤离执行。
 * 远程来袭和不许攻击的目标只走撤离,近战的攻击仍由权限层决定。
 *
 * <h2>为什么仍然是一条反射链,而不是直接换掉她手上的活</h2>
 * 反射链是<b>抢占 + 归还</b>:她挖着矿被打断,打完矿照样接着挖({@code stop(PREEMPTED)} 明确
 * 不动逻辑字段)。若改成顶掉当前任务槽,挖矿就真没了——持久化存的是那次工具调用而不是进度,
 * 重派等于从头挖一遍。
 *
 * <h2>什么算危险</h2>
 * 近战看碰撞箱与爆炸半径;远程看当前针对和视线,或五秒内真实受击来源。
 * 感知有三十二格上限,不会把旁边未交战的中立生物当作攻击目标。
 */
public final class MobDefenseChain implements Task, Reflex {

    /** 本能名册里的 id。别处按住这条本能时用它,见 {@code NumenPlayer.pauseReflex}。 */
    public static final String ID = "mob_defense";

    /** 看多远。超出这个半径的不算"身边"。 */
    private static final double SCAN_RADIUS = Menace.FLEE_DISTANCE;

    /**
     * 危险离开后还盯这么久才算真的没事。
     *
     * <p>没有它,一只跟她跑得几乎一样快的怪会在边界上一进一出,每进出一次就重开一场仗。
     */
    private static final long CALM_GRACE_TICKS = 40;

    /** {@link #dangerLastSeenTick} 的"从没见过"哨兵。不参与减法,免得负溢出。 */
    private static final long NEVER = Long.MIN_VALUE;

    /** 自动开的这场仗。null = 这一刻没在打。 */
    private AttackCompanionTask fight;
    /** 最后一刻还看得见危险的游戏时间。 */
    private long dangerLastSeenTick = NEVER;
    private long blockedUntilTick;
    private int blockedHurtTimestamp;

    public MobDefenseChain() {
    }

    /**
     * 危险来了就醒。正常结束没有冷却;连续三次撤离无路后给普通任务两秒窗口,
     * 新受击立即打断这个窗口。高优先反射仍能随时抢占。
     */
    @Override
    public boolean canRun(NumenPlayer companion) {
        long now = companion.level().getGameTime();
        // 有人正在替这条本能干活(模型派的 attack),就别抢 —— 除非她已经扛不住,
        // 那一档只有本能看得见。按住的是本能不是目标,所以会分裂的怪不会让它失效。
        if (fight == null && companion.reflexPaused(ID) && !Menace.outmatched(companion)) {
            return false;
        }
        if (fight != null) {
            return true;   // 打着呢,打完再说
        }
        // 无路时给普通任务一个有界窗口;新的一击会立即重新唤醒,不被退避吞掉。
        if (now < blockedUntilTick
                && companion.getLastHurtByMobTimestamp() == blockedHurtTimestamp) return false;
        if (SurvivalDecisions.mobDefenseTriggered(!dangersNear(companion).isEmpty())) {
            return true;
        }
        // 宽限期内不撒手:怪刚出半径不代表没事了,这一刻放手下一刻就得重来。
        return dangerLastSeenTick != NEVER && now - dangerLastSeenTick < CALM_GRACE_TICKS;
    }

    @Override
    public TaskState tick(NumenPlayer companion) {
        if (!dangersNear(companion).isEmpty()) {
            dangerLastSeenTick = companion.level().getGameTime();
        }
        if (fight == null) {
            if (dangersNear(companion).isEmpty()) {
                return TaskState.RUNNING;   // 宽限期里的空转,别开新的一场
            }
            begin(companion);
            return TaskState.RUNNING;
        }
        if (requiresRetreat(companion)) fight.retreatFromDanger();
        TaskState state = fight.tick(companion);
        if (state != TaskState.RUNNING) {
            end(companion, state);
        }
        return TaskState.RUNNING;
    }

    /**
     * 开打。<b>无差别</b>:身边的危险不是模型点名的,而且会分裂的怪一裂开,点名就作废了。
     *
     * <p>不设截止时间——它的终点是"没人再追我",由 {@code attack} 自己判;
     * 给一个闹钟只会在打到一半时把她扔在原地。
     */
    private void begin(NumenPlayer companion) {
        long now = companion.level().getGameTime();
        AttackTaskRecord record = new AttackTaskRecord(
                "reflex-" + now, now + NO_DEADLINE, List.of(), true);
        // 远程来袭与不许攻击的生物只撤离;禁止攻击不能同时禁止她离开危险。
        boolean retreatOnly = requiresRetreat(companion);
        fight = new AttackCompanionTask(companion, record, retreatOnly);
        fight.start(companion);
        com.dwinovo.numen.Constants.LOG.info("[numen-defense] 自动接管 —— 身边 {} 个危险",
                dangersNear(companion).size());
    }

    private boolean requiresRetreat(NumenPlayer companion) {
        return dangersNear(companion).stream().anyMatch(foe ->
                Menace.rangedThreat(foe, companion)
                        || !com.dwinovo.numen.permission.Permission.judge(companion,
                        com.dwinovo.numen.permission.Action.attack(foe)).allowed());
    }

    /** 长到等同于没有截止时间;终点由"没人再追我"说了算。 */
    private static final long NO_DEADLINE = 20L * 60L * 60L * 24L;

    private void end(NumenPlayer companion, TaskState state) {
        String line = fight.result(state).message();
        if (fight.retreatBlocked()) {
            blockedUntilTick = companion.level().getGameTime() + CALM_GRACE_TICKS;
            blockedHurtTimestamp = companion.getLastHurtByMobTimestamp();
        }
        fight = null;
        dangerLastSeenTick = NEVER;
        InputDriver.halt(companion);
        companion.setShiftKeyDown(false);
        com.dwinovo.numen.Constants.LOG.info("[numen-defense] 收场 {} —— {}", state, line);
        // <b>不急</b>:她的后台任务照跑,黄了自有 task_finished 报。这条只是让主人翻聊天流时
        // 看得懂她刚才为什么打了一架、或者挪了二十格。攒着搭下一轮的车就够。
        com.dwinovo.numen.event.NumenEvents.reflex(companion, this,
                "defense reflex ended — " + line);
    }

    @Override
    public void stop(NumenPlayer companion, StopReason why) {
        if (fight != null) {
            // 被更急的链抢走(摔落、换气):只松开身体,这场仗的状态一个不动,回来接着打。
            fight.stop(companion, why);
        }
        InputDriver.halt(companion);
        companion.setShiftKeyDown(false);
    }

    @Override
    public String name() {
        return ID;
    }

    // ---- Reflex roster paperwork (constitution §6) ----

    @Override
    public String id() {
        return name();
    }

    @Override
    public String describe() {
        return "近身危险自动自卫;远程来袭或不许攻击的威胁只撤离,受阻如实报告";
    }

    // ---- 什么算危险 ----

    /**
     * 身边<b>已经近到没有提前量</b>的威胁。
     *
     * <p>只算正在针对她的——防守不是挑衅,一只路过的僵尸猪灵不该被"防御"链招惹。还没逼近的
     * 那些也不进来:模型看得见它们,该由它决定要不要动手。
     *
     * <p>模型自己派的 {@code attack} 已经认领的目标同样不算:那场仗有人管了。但她扛不住时
     * 一律接管——那一档只有本能看得见。
     */
    private List<LivingEntity> dangersNear(NumenPlayer companion) {
        List<LivingEntity> near = new ArrayList<>();
        for (LivingEntity foe : Menace.defenseThreats(companion, SCAN_RADIUS)) {
            if (Menace.defenseDanger(foe, companion)) {
                near.add(foe);
            }
        }
        return near;
    }
}
