export const AUTOMATION_EVENT_TYPES = [
  'CONTROLLER_CONNECTED','CONTROLLER_DISCONNECTED','PUMP_STATE_CHANGED','NOZZLE_STATE_CHANGED','DISPENSING_STARTED','DISPENSING_PROGRESS','DISPENSING_COMPLETED','DEVICE_DISCOVERED',
  'CONTROLLER_STATUS_CHANGED',
  'PUMP_STATUS_CHANGED',
  'NOZZLE_STATUS_CHANGED',
  'FUEL_TRANSACTION_STARTED',
  'FUEL_TRANSACTION_UPDATED',
  'FUEL_TRANSACTION_COMPLETED',
  'TOTALIZER_READING_RECEIVED',
  'TANK_READING_RECEIVED',
  'DELIVERY_CANDIDATE_DETECTED',
  'EQUIPMENT_ERROR_REPORTED',
  'ATG_TANK_READING','TANK_LEVEL_READING','TANK_VOLUME_READING','TANK_TEMPERATURE_READING','TANK_WATER_LEVEL_READING',
] as const;

export type AutomationEventType = typeof AUTOMATION_EVENT_TYPES[number];

export interface TotalizerReadingPayload {
  externalPumpId: string;
  externalNozzleId?: string;
  stationId?: string;
  productId?: string;
  productCode?: string;
  externalProductId?: string;
  totalizerValue: number;
  unit: 'L';
  /** A decrease is a reset only when the adapter supplies explicit evidence. */
  resetIndicator?: boolean;
}

export interface AtgTankReadingPayload {
  stationId?: string;
  externalTankId?: string;
  productId?: string;
  productCode?: string;
  level?: number;
  levelUnit?: 'MM';
  volume?: number;
  volumeUnit?: 'L';
  temperature?: number;
  temperatureUnit?: 'C';
  waterLevel?: number;
  waterLevelUnit?: 'MM';
  sensorReset?: boolean;
}

export interface AutomationEventEnvelope<TPayload = unknown> {
  /** Stable vendor ID or deterministic adapter-generated ID. */
  eventId: string;
  eventType: AutomationEventType;
  controllerId: string;
  externalDeviceId?: string | null;
  deviceType?: 'CONTROLLER'|'PUMP'|'NOZZLE'|'TANK'|'PRODUCT'|null;
  sourceSequence?: string | null;
  sourceOccurredAt: string;
  receivedAt: string;
  schemaVersion: number;
  payload: TPayload;
  rawPayloadHash: string;
  correlationId?: string | null;
  source?: string;
}

export interface AutomationEventReceipt {
  inboxId: string;
  duplicate: boolean;
  processingStatus: import('./states.js').AutomationEventProcessingStatus;
}
