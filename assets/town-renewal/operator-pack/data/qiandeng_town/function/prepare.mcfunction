# Safe to call repeatedly before an attempt. Does not alter blocks/entities.
scoreboard objectives add qdtown_20260920 dummy
scoreboard players add #attempted qdtown_20260920 0
scoreboard players add #applied qdtown_20260920 0
scoreboard players set #ready qdtown_20260920 0
scoreboard players set #conflicts qdtown_20260920 0
execute if score #attempted qdtown_20260920 matches 1.. run scoreboard players add #conflicts qdtown_20260920 1
scoreboard players add #conflicts qdtown_20260920 0
execute in minecraft:overworld run function qiandeng_town:preflight
execute if score #conflicts qdtown_20260920 matches 0 run scoreboard players set #ready qdtown_20260920 1
scoreboard players get #conflicts qdtown_20260920
