# Scratch scoreboard only; never resets the attempted lock.
scoreboard objectives add qdbri_20260920 dummy
scoreboard players add #attempted qdbri_20260920 0
scoreboard players add #applied qdbri_20260920 0
scoreboard players set #ready qdbri_20260920 0
scoreboard players set #conflicts qdbri_20260920 0
execute if score #attempted qdbri_20260920 matches 1.. run scoreboard players add #conflicts qdbri_20260920 1
execute in minecraft:overworld run function qiandeng_bridge:preflight
execute if score #conflicts qdbri_20260920 matches 0 run scoreboard players set #ready qdbri_20260920 1
scoreboard players get #conflicts qdbri_20260920
