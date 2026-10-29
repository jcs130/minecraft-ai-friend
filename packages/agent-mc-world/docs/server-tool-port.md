# Explicit server tools on an existing body

`agent-mc-world/server-tools` exports `createServerToolRouter` and
`SERVER_TOOL_PORT_TOOL`. This entry imports neither a Minecraft body nor a host
adapter. The client and extension entries export the same functions.

Pass the tools from an explicitly installed server package to the router. It
exposes the `mc_server` tool. `{}` reads the registered names, descriptions,
argument schemas and current availability. To invoke an operation, use its
registered name and an argument object:

```ts
const router = createServerToolRouter(serverTools);
await router.handler({ operation: selected.name, arguments: suppliedArguments }, context);
```

The router validates both the outer call and the selected provider's schema
without coercing or dropping fields. At most 64 operations may be registered;
duplicate names fail registration. It forwards the original call context,
including call identity and cancellation signal. A cancellation observed before
dispatch invokes no provider. Host call identity, persistence and replay rules
remain with the host; this router does not run a second executor.

The tool is a barrier: read its result before submitting another action. The
provider owns authentication, connection scope, permissions, cooldowns and
native effect evidence. A tool's presence does not establish availability, and a
sent command does not establish a successful effect or completed goal. A handler
exception leaves effects unknown and is never retried automatically.

The routing call does not acquire movement control, stop combat or change a
body task queue. Only register server operations that can use that contract.
Keep queued movement, construction and other body actions on the body's
existing tools. Server command compilation and reply parsing belong in the
server package.
