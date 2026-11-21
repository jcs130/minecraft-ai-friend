import { startMineflayerDevice } from './mineflayer-device.mjs';

const startupToken = process.env.AGENT_MC_MANAGED_DEVICE_TOKEN;
delete process.env.AGENT_MC_MANAGED_DEVICE_TOKEN;

/** Compose the same SDK runtime and typed settings in every stdio assembly. */
export function managedRuntime(binding, options, createRuntime, log) {
  const publicOptions = { metricsPort: options.metricsPort, consolePort: options.consolePort,
    operatorBinding: options.operatorBinding };
  if (!binding) return { ...publicOptions, runtime: createRuntime(undefined) };
  if (options.cfg.provider === 'java-client') throw Error('Managed devices require the original Mineflayer body');
  return startMineflayerDevice({ characterId: binding.characterId, endpoint: binding.endpoint,
    token: startupToken, createRuntime(port) {
      const runtime = createRuntime(port);
      if (typeof runtime.prepareTargetBodyHandoff !== 'function') throw Error('Managed body requires a verified newer SDK');
      return runtime;
    }, onStop: () => log.warn('Managed player-device authorization ended') })
    .then(device => ({ ...publicOptions, runtime: device.runtime, close: device.close }));
}
