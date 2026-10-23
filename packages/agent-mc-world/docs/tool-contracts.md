# `src/client/tool-help.ts`: tool contracts and on-demand parameter notes

`withToolHelp(tools, name, { parameterDescriptions: 'on-demand' })` keeps tool names,
execution handlers and every JSON Schema constraint. Parameter `description` annotations
remain in the help catalogue instead of the repeatedly advertised parameters. Top-level
tool descriptions stay inline. The default is `inline`.

The mounted help tool reads the original effective schema after host renaming. Read its
index, select a tool, and follow returned JSON pointers; `full: true` returns the exact
selected node. Constants, enums, defaults and examples retain literal application data,
including fields named `description`. Help never executes a game action or calls a model.

Hosts can select this projection through the public `agent-mc-world/client` or
`agent-mc-world/extension` export. Large or unfamiliar action parameters still need
their exact help; compact advertisement does not add aliases or accept malformed inputs.
