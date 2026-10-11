# Keep Mineflayer's vanilla whisper packet: Essentials disables its msg command
# but still owns w/tell/whisper. Only replace those aliases, using the sender's
# own permissions and the normal command preprocess guards.
qd_vanilla_private_chat:
  type: command
  debug: false
  name: w
  description: 使用原版私聊向玩家发送消息
  usage: /w <玩家> <消息>
  aliases:
  - tell
  - whisper
  script:
  - if <context.source_type> == PLAYER:
    # Check here so a denied player receives a useful explanation rather than
    # Brigadier hiding the alias as an unknown command. The native command also
    # checks this permission and runs all normal preprocess listeners.
    - if !<player.has_permission[minecraft.command.msg]>:
      - narrate "<red>当前账号没有私聊权限，请联系房管检查 minecraft.command.msg。"
      - stop
    - execute as_player "minecraft:msg <context.raw_args>"
  - else:
    - execute as_server "minecraft:msg <context.raw_args>"
