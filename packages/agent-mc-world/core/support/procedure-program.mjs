/** SES procedure composition; the adapter supplies capabilities and owns the Worker/time budget. */
export function procedureProgram(graph, options) {
  let serial = 0;
  const pending = new Set();
  const copy = value => {
    const text = JSON.stringify(value ?? {});
    if (text.length > 4096) throw new Error('procedure params exceed 4096 characters');
    return harden(JSON.parse(text));
  };
  const compile = (revision, params, scope, validate) => {
    const version = graph.versions[revision];
    let childRunning = false;
    const methods = harden({ run: async (alias, childParams = {}) => {
      if (validate) throw new Error('validation cannot invoke procedures');
      if (childRunning) throw new Error('procedure dependencies must be awaited serially');
      if (!Object.hasOwn(version.dependencies, alias)) throw new Error(`undeclared procedure dependency: ${alias}`);
      childRunning = true;
      try { return await invoke(version.dependencies[alias].revision, childParams, scope.invocation); }
      finally { childRunning = false; }
    } });
    const compartment = new Compartment({ ...options.capabilities(scope), params: copy(params), methods });
    const program = compartment.evaluate(`(async () => {\n${version.code}\n})`);
    if (typeof program !== 'function') throw new Error('procedure code must be an async function body');
    return program;
  };
  const invoke = async (revision, params, parent) => {
    if (++serial > options.maxInvocations) throw new Error('procedure invocation budget exceeded');
    const scope = { invocation: serial, revision, ...(parent === undefined ? {} : { parent }) };
    pending.add(scope.invocation);
    options.onInvocation({ ...scope, status: 'running' });
    try {
      const result = await compile(revision, params, scope, false)();
      const text = JSON.stringify(result ?? null);
      if (text.length > 24000) throw new Error('procedure result exceeds 24000 characters');
      options.onInvocation({ ...scope, status: 'completed' });
      return harden(JSON.parse(text));
    } catch (error) {
      options.onInvocation({ ...scope, status: 'failed', error: String(error).slice(0, 1600) });
      throw error;
    } finally { pending.delete(scope.invocation); }
  };
  return {
    validate() {
      for (const revision of Object.keys(graph.versions)) compile(revision, {}, { revision, invocation: 0 }, true);
      return { valid: true, versions: Object.keys(graph.versions).length };
    },
    async run(params) {
      const result = await invoke(graph.root, params);
      if (pending.size) throw new Error('procedure ended with an unawaited dependency');
      return result;
    },
  };
}
