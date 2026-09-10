import type { AutomationCapability } from './capabilities.js';
import type { ControllerState } from './states.js';

export interface AutomationControllerConfiguration {
  id: string;
  stationId: string;
  name: string;
  adapterType: string;
  host?: string | null;
  port?: number | null;
  connectionType: string;
  timeoutMs: number;
  credentialRef?: string | null;
  configuration?: Readonly<Record<string, unknown>> | null;
  status: ControllerState;
  enabled: boolean;
  lastCommunicationAt?: string | null;
  lastSuccessfulConnectionAt?: string | null;
  lastError?: string | null;
  capabilities?: readonly import('./capabilities.js').AutomationCapability[];
  firmwareVersion?: string | null;
}

export interface AutomationAdapterHealth {
  state: ControllerState;
  checkedAt: string;
  lastCommunicationAt?: string | null;
  message?: string;
}

export interface AutomationAdapterContext {
  controller: AutomationControllerConfiguration;
  signal: AbortSignal;
  emit: (event: import('./events.js').AutomationEventEnvelope) => Promise<void>;
}

export interface AutomationAdapterConfigurationValidation {
  valid: boolean;
  errors: readonly string[];
  capabilities: ReadonlySet<AutomationCapability>;
}
