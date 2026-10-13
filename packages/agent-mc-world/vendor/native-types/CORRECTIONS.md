# Declaration corrections

These files describe the pinned native dependencies used by the optional server-extension API. They are not loaded at runtime. Each upstream file, package version, original hash and corrected hash is recorded in `manifest.json`; each package retains its license. Internal imports were relocated to make the declaration graph portable.

- `protodef`: valid optional tuple syntax, ambient fields and parameters, stream import, compiler spelling, exported declarations and error constructor type.
- `prismarine-nbt`: export module declarations and correctly type the compiler/interpreter instances.
- `prismarine-block` / `prismarine-item`: declare the loader and normalized enchant shape; use an ESM-compatible default declaration.
- `prismarine-chat` / `prismarine-chunk`: annotate missing parameters and return/record types; unknown NBT input stays unknown.
- `prismarine-windows`: preserve the event map generic while allowing the named event interfaces used by Mineflayer.
- `mineflayer-pathfinder`: correct World type import, describe the AStar computation result, remove illegal parameter initializers, qualify event goal types.
- `@types/readable-stream`: express the optional stream symbol member as a mapped type for TypeScript 5.7.

All eight public code entrypoints are checked with `skipLibCheck: false` in both Bundler and NodeNext resolution. Updating native dependencies requires reviewing these copies and hashes again. The SDK, MCP and neutral contracts do not require native Bot declarations.
