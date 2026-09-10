export const AUTOMATION_EQUIPMENT_TYPES = ['PUMP', 'NOZZLE', 'TANK'] as const;
export type AutomationEquipmentType = typeof AUTOMATION_EQUIPMENT_TYPES[number];

export const AUTOMATION_MAPPING_STATUSES = ['ACTIVE', 'DISABLED', 'CONFLICT'] as const;
export type AutomationMappingStatus = typeof AUTOMATION_MAPPING_STATUSES[number];

export interface AutomationDeviceMapping {
  id: string;
  controllerId: string;
  equipmentType: AutomationEquipmentType;
  externalParentId: string;
  externalEquipmentId: string;
  pumpId?: string | null;
  nozzleId?: string | null;
  tankId?: string | null;
  status: AutomationMappingStatus;
}

