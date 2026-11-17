# Entity interaction can open a plugin menu

Minecraft 1.21.1 is the primary acceptance target. Mineflayer 4.39.0 `openVillager` calls `openEntity`, then rejects any window whose type is not `minecraft:villager` or `minecraft:merchant`. Paper plugins can legitimately open a generic button menu for the same right-click. An exception from the merchant adapter therefore does not establish that interaction failed or that no window exists.

The shared `use target:"villager"` path now distinguishes these outcomes:

- Native merchant: retain quotation and trade-index behavior, including closing its finished window.
- Newly opened plugin window, no trade index: return the bounded current slot/name/lore readout and leave the window available to `mc_window`, `menu_click` and `menu_close`. Opening is not a purchase or possession of the icon items.
- Plugin window with a vanilla trade index: report the incompatible operation and the safe `mc_window` read entry. Do not reinterpret a trade index as a slot or click anything automatically.
- Cancelled action: clean up its newly opened window and its own merchant packet listeners. A failed attempt must not claim or close a pre-existing unrelated window.

The existing menu-click spending and server-command contracts are unchanged. This fix does not make all plugin shops writable, bypass their purchase flow, or prove a purchase completed. Callers should read current menu entries and use the server's documented transaction interface when required.

`tests/plugin-merchant-window.test.ts` injects the actual installed Mineflayer villager plugin into a local 1.21.1 registry fixture. It reproduces the generic-window exception, then checks a later actual menu-click implementation, index separation, listener cleanup, cancellation, stale-window isolation, and normal merchant quotation behavior. No production server, model, currency or player state is used.

Primary source checked 2026-11-17: [Mineflayer villager plugin](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/villager.js), file blob `ce5760f48ea1588fd19fecaa82f297e936d960c0`. The GitHub default-branch file and pinned local dependency were checked independently.
