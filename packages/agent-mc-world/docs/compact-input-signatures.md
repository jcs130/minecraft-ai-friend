# Compact input field relationships

`preserveToolInputSignatures(source, projected)` is exported from
`agent-mc-world/context`. Call it after abbreviating schema descriptions. It
restores a small, registry-derived field index on the `skill` discriminator,
including required fields and declared alternatives. It also resolves the full
schema retained by `withToolHelp(..., { parameterDescriptions: 'on-demand' })`.

The flat property pool alone cannot express which fields belong to which skill.
Removing the generation directory and shortening the long `steps` description
used to lose that relationship: `look` needs `at`, and `harvest` needs `block`
and `at`. Keeping the index avoids requiring another help lookup for these basic
field relationships. Conditional execution rules still use the full help.

The projection does not change validators, select targets, repair arguments,
invoke tools, or replace the original declaration. Full help keeps the original
schema, including generation alternatives. It is idempotent and skips malformed
generation metadata instead of inventing a contract.
