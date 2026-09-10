import type { ControllerRecord } from './controller-repository.js';
import { SimulatorAdapter } from '../adapters/simulator-adapter.js';

export interface ControllerConnectionTestResult {
  success: boolean;
  timestamp: string;
  responseTimeMs: number;
  controllerId: string;
  message: string;
}

/** Controlled in-process simulator. It performs no DNS lookup, socket, or HTTP request. */
export async function testSimulatorConnection(controller: ControllerRecord): Promise<ControllerConnectionTestResult> {
  if (controller.controllerType !== 'SIMULATOR' || controller.connectionType !== 'SIMULATOR') {
    throw new Error('Connection testing is restricted to SIMULATOR controllers in Phase 2.');
  }

  const startedAt = performance.now();
  const adapter = new SimulatorAdapter();
  await adapter.initialize({ controllerId: controller.id, configuration: controller.configuration, emit: async () => {}, log: () => {} });
  const timestamp = new Date().toISOString();
  try {
    await adapter.connect();
    const health = await adapter.healthCheck();
    await adapter.shutdown();
    return { success: true, timestamp, responseTimeMs: health.latencyMs || Math.max(1, Math.round(performance.now()-startedAt)), controllerId: controller.id, message: 'Simulator adapter connection successful.' };
  } catch (error) {
    await adapter.shutdown();
    return {
      success: false,
      timestamp,
      responseTimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
      controllerId: controller.id,
      message: error instanceof Error ? error.message : 'Controlled simulator reported an unavailable controller.',
    };
  }
}
