export const CONTROLLER_STATES = ['ONLINE', 'OFFLINE', 'CONNECTING', 'ERROR', 'DISABLED', 'UNKNOWN'] as const;
export type ControllerState = typeof CONTROLLER_STATES[number];

export const EQUIPMENT_STATES = [
  'ONLINE',
  'OFFLINE',
  'IDLE',
  'AUTHORIZED',
  'DISPENSING',
  'STOPPED',
  'ERROR',
  'UNKNOWN',
] as const;
export type EquipmentState = typeof EQUIPMENT_STATES[number];

export const AUTOMATION_EVENT_PROCESSING_STATUSES = [
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
] as const;
export type AutomationEventProcessingStatus = typeof AUTOMATION_EVENT_PROCESSING_STATUSES[number];
