# Rechecks and writes in one synchronous function chain.
function qiandeng_bridge:prepare
execute unless score #ready qdbri_20260920 matches 1 run return 0
scoreboard players set #attempted qdbri_20260920 1
scoreboard players set #inflight qdbri_20260920 1
execute in minecraft:overworld store result score #commit_result qdbri_20260920 run function qiandeng_bridge:commit
scoreboard players set #inflight qdbri_20260920 0
scoreboard players set #ready qdbri_20260920 0
execute if score #commit_result qdbri_20260920 matches 1 run scoreboard players set #applied qdbri_20260920 1
execute unless score #commit_result qdbri_20260920 matches 1 run return 0
return 1
