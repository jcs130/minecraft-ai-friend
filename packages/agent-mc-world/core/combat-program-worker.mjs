import { parentPort, workerData } from 'node:worker_threads';
import { Script } from 'node:vm';
import 'ses';

lockdown({ errorTaming: 'unsafe', consoleTaming: 'safe' });
try {
  const source = `(frame, params) => {\n${workerData.code}\n}`;
  new Compartment().evaluate(source);
  const evaluate = new Script('run()');
  parentPort.on('message', ({ frame, params }) => {
    try {
      const startedAt = performance.now();
      // SES owns capabilities; the VM timeout also covers getters during serialization.
      const text = evaluate.runInNewContext({ run: () => {
        const result = new Compartment().evaluate(source)(harden(frame), harden(params));
        if (result && typeof result.then === 'function') throw new Error('Combat program must be synchronous');
        const serialized = JSON.stringify(result);
        if (!serialized || serialized.length > workerData.outputChars) throw new Error('Combat program output exceeds budget');
        return serialized;
      } }, { timeout: workerData.evaluationMs });
      parentPort.postMessage({ kind: 'result', value: JSON.parse(text), evaluationMs: performance.now() - startedAt });
    } catch (error) { parentPort.postMessage({ kind: 'error', error: error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
      ? 'Combat program exceeded evaluation budget' : String(error).slice(0, 1600) }); }
  });
  parentPort.postMessage({ kind: 'ready' });
} catch (error) { parentPort.postMessage({ kind: 'error', error: String(error).slice(0, 1600) }); }
