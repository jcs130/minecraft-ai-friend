# Internal synchronous commit. Use apply; never call this as a standalone entrypoint.
execute unless score #inflight qdbri_20260920 matches 1 run return 0
execute unless score #ready qdbri_20260920 matches 1 run return 0
execute unless score #attempted qdbri_20260920 matches 1 run return 0
execute unless score #applied qdbri_20260920 matches 0 run return 0
scoreboard players set #progress qdbri_20260920 0
scoreboard players set #verified qdbri_20260920 0
scoreboard players set #ok qdbri_20260920 0
execute if block -513 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -513 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -513 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 1
scoreboard players set #ok qdbri_20260920 0
execute if block -513 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -513 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -513 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 2
scoreboard players set #ok qdbri_20260920 0
execute if block -513 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -513 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -513 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 3
scoreboard players set #ok qdbri_20260920 0
execute if block -512 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -512 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -512 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 4
scoreboard players set #ok qdbri_20260920 0
execute if block -512 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -512 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -512 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 5
scoreboard players set #ok qdbri_20260920 0
execute if block -512 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -512 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -512 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 6
scoreboard players set #ok qdbri_20260920 0
execute if block -511 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -511 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -511 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 7
scoreboard players set #ok qdbri_20260920 0
execute if block -511 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -511 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -511 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 8
scoreboard players set #ok qdbri_20260920 0
execute if block -511 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -511 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -511 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 9
scoreboard players set #ok qdbri_20260920 0
execute if block -509 63 865 minecraft:spruce_slab[type=bottom,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -509 63 865 minecraft:spruce_slab[type=bottom,waterlogged=false] store success score #ok qdbri_20260920 run setblock -509 63 865 minecraft:spruce_slab[type=bottom,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 10
scoreboard players set #ok qdbri_20260920 0
execute if block -514 63 865 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -514 63 865 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] store success score #ok qdbri_20260920 run setblock -514 63 865 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 11
scoreboard players set #ok qdbri_20260920 0
execute if block -514 63 866 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -514 63 866 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] store success score #ok qdbri_20260920 run setblock -514 63 866 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 12
scoreboard players set #ok qdbri_20260920 0
execute if block -514 63 867 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -514 63 867 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] store success score #ok qdbri_20260920 run setblock -514 63 867 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 13
scoreboard players set #ok qdbri_20260920 0
execute if block -510 63 866 minecraft:spruce_stairs[facing=west,half=bottom,shape=straight,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -510 63 866 minecraft:spruce_stairs[facing=west,half=bottom,shape=straight,waterlogged=false] store success score #ok qdbri_20260920 run setblock -510 63 866 minecraft:spruce_stairs[facing=west,half=bottom,shape=straight,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 14
scoreboard players set #ok qdbri_20260920 0
execute if block -510 63 867 minecraft:spruce_stairs[facing=west,half=bottom,shape=straight,waterlogged=false] run scoreboard players set #ok qdbri_20260920 1
execute unless block -510 63 867 minecraft:spruce_stairs[facing=west,half=bottom,shape=straight,waterlogged=false] store success score #ok qdbri_20260920 run setblock -510 63 867 minecraft:spruce_stairs[facing=west,half=bottom,shape=straight,waterlogged=false] replace
execute unless score #ok qdbri_20260920 matches 1 run return 0
scoreboard players set #progress qdbri_20260920 15
execute unless block -513 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 1
execute unless block -513 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 2
execute unless block -513 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 3
execute unless block -512 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 4
execute unless block -512 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 5
execute unless block -512 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 6
execute unless block -511 64 865 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 7
execute unless block -511 64 866 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 8
execute unless block -511 64 867 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 9
execute unless block -509 63 865 minecraft:spruce_slab[type=bottom,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 10
execute unless block -514 63 865 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 11
execute unless block -514 63 866 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 12
execute unless block -514 63 867 minecraft:spruce_stairs[facing=east,half=bottom,shape=straight,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 13
execute unless block -510 63 866 minecraft:spruce_stairs[facing=west,half=bottom,shape=straight,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 14
execute unless block -510 63 867 minecraft:spruce_stairs[facing=west,half=bottom,shape=straight,waterlogged=false] run return 0
scoreboard players set #verified qdbri_20260920 15
execute unless block -512 63 866 minecraft:water[level=7] run return 0
scoreboard players set #verified qdbri_20260920 16
execute unless block -513 63 867 minecraft:water[level=7] run return 0
scoreboard players set #verified qdbri_20260920 17
execute unless block -512 63 867 minecraft:water[level=6] run return 0
scoreboard players set #verified qdbri_20260920 18
execute unless block -511 63 867 minecraft:water[level=7] run return 0
scoreboard players set #verified qdbri_20260920 19
execute unless block -510 63 865 minecraft:gravel run return 0
scoreboard players set #verified qdbri_20260920 20
return 1
