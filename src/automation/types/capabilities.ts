export const AUTOMATION_CAPABILITIES = [
  'PUMP_STATUS_READ',
  'NOZZLE_STATUS_READ',
  'FUEL_TRANSACTION_READ',
  'TOTALIZER_READ',
  'TANK_READING_READ',
  'DELIVERY_EVENT_READ',
  'EQUIPMENT_HEALTH_READ',
  'DISCOVERY',
  'DISPENSING_EVENTS',
  'TRANSACTIONS',
  'TOTALIZERS',
  'TANK_READINGS',
] as const;

/**
 * Phase 1 intentionally contains read-only capabilities. Equipment command
 * capabilities are excluded until a separately approved control-safety phase.
 */
export type AutomationCapability = typeof AUTOMATION_CAPABILITIES[number];
