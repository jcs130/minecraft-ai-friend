# Rechecks immediately before synchronous writes. Never resets attempted.
function qiandeng_town:prepare
execute unless score #ready qdtown_20260920 matches 1 run return 0
scoreboard players set #attempted qdtown_20260920 1
scoreboard players set #inflight qdtown_20260920 1
execute in minecraft:overworld store result score #commit_result qdtown_20260920 run function qiandeng_town:commit
scoreboard players set #inflight qdtown_20260920 0
scoreboard players set #ready qdtown_20260920 0
execute if score #commit_result qdtown_20260920 matches 1 run scoreboard players set #applied qdtown_20260920 1
execute unless score #commit_result qdtown_20260920 matches 1 run return 0
return 1
