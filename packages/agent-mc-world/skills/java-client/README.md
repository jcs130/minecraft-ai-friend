# Real client Python programs (Minescript 4.0)

These are optional **MIT** helpers owned by Agent MC World. They call the public API of the separately installed Minescript mod; no upstream GPL implementation is included. There is no model, planning loop, launcher, background job or network access in the helper.

Copy `agent_mc.py` explicitly into the actual client's `minescript/` directory. Keep the original native queue, controller lease and `action_id`; invoke it through `mc_script`, then reconcile `mc_result`/`mc_wait`. Installing the file does not execute a program or require restarting the game. A script that has already imported the module retains that module until it exits.

```python
import agent_mc
result = agent_mc.scan_nearby(
    radius=6, below=2, above=2,
    names=['minecraft:carrots', 'minecraft:wheat'], limit=12)
```

Discover exact signatures, limits, examples and result fields locally:

```python
import agent_mc
result = agent_mc.help('scan_blocks')  # omit the topic for the index
```

Use the returned `position: [x,y,z]` field for coordinates (`position[1]` is y). There are no `block_at` or `look` methods in this module. Python's builtin `help()` prints to stdout and returns `None`; `agent_mc.help()` returns JSON documentation usable by the Agent. A radius is half the width; volume is `(2*radius+1)^2*(below+above+1)`, not `radius^2*height`.

This reads 845 positions using four `getblocklist` batches, rather than 845 synchronous Python/game crossings. The whole scan is limited to 4096 blocks and 64 returned matches. Returned positions are absolute; negative coordinates use floor. Names, properties such as crop `age`, original strings, sample times, total matches and truncation remain explicit. Results are client cache observations, not authoritative server acceptance; `void_air` is marked `void_or_unloaded` and incomplete batches fail. The scan never requests new chunks.

`sample_blocks([[x,y,z],...])` returns up to 512 specific blocks. `scan_blocks(minimum,maximum,names=[],limit=32)` scans an inclusive cuboid. `wait(seconds)` uses a bounded Python wait of 0–5 seconds; keep the whole program inside its native timeout and lease. Use `mc_script` API pages for movement, view, interaction and inventory examples. No nonexistent `minescript.sleep` or dictionary block API is assumed.

`interact_block(position, action='attack', hold=0.3, max_distance=4.5, aim_offset=[0.5,0.5,0.5], observe_positions=[])` is an optional explicitly selected body program. It checks the current GUI, cached target and actual crosshair position/distance before pressing one attack/use key; it always releases that key. It returns observed before/after block strings and a bounded report, without moving, pathfinding, retrying or completing a host goal. A blocked target or `no_observed_change` requires new evidence or a different position/method. The raycast bound is an observation limit, not server reach/permission proof; default 4.5 is conservative and may be configured explicitly for the installed game.

For planting, select the correct held item separately and target the real support farmland, with an aim point appropriate to its shape. For example, inside an admitted `mc_script` job with `input.target` chosen from actual observations:

```python
import agent_mc
result = agent_mc.interact_block(input_data['target'], action='use', hold=0.15,
    aim_offset=[0.5,0.9,0.5], observe_positions=input_data['observe'])
```

For crops occupying the air above farmland, explicitly include that neighboring block in `observe_positions` (at most four absolute positions), and inspect inventory/server notices: using the farmland can plant successfully while the support's own block string stays unchanged. These related blocks are read in bounded batches. `player_press_right` is rightward movement; right mouse use is `player_press_use`, which this helper selects for `action='use'`. No helper report substitutes for a server objective receipt.

Programs remain trusted local Python, not a sandbox. A report of mature crops is not proof of harvesting them. Check actual reach, held item and GUI first, then verify changed blocks/inventory/server receipts. An unexpected backpack menu is a real effect to inspect, not a reason to continue moving or clicking blindly.

Offline helper checks:

```sh
python -B -m unittest discover -s tests/python -v
```

Pinned upstream reference: [Minescript 4.0 API](https://github.com/maxuser0/minescript/blob/main/docs/v4.0/README.md).
