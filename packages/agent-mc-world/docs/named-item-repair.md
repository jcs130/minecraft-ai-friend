# Named item repair

An existing display name is not a repair permission gate. Anvil repair accepts the
registry ID plus `pick`, or the exact current display name. It moves the selected
item through the existing station slots, without rebuilding its components.
Without an explicit `name`, no rename packet is sent: formatted custom names and
opaque server components are left to the server's recipe. Supplying `name` with
`repair` or `combine` requests repair and rename in the same operation.

The server controls the output, item attributes and XP cost. An empty output slot
does not establish that a named item or a recipe is forbidden. Report the missing
output and preserve that uncertainty. A displayed output is not proof of delivery;
an undelivered preview is reported as unconfirmed, without claiming repair success.

References: [Mineflayer anvil API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md#anvilcombineitemone-itemtwo-name),
[1.21.1 anvil handler contract](https://maven.fabricmc.net/docs/yarn-1.21.1+build.3/net/minecraft/screen/AnvilScreenHandler.html).

Offline tests cover named component items, distinct inputs, unchanged original
components, an explicit combined rename and an absent server output. They do not
establish that a particular live server accepts any custom equipment recipe.
