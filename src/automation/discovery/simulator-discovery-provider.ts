export type DiscoveryDeviceType = 'PUMP' | 'NOZZLE' | 'TANK' | 'PRODUCT';

export interface DiscoveredDevice {
  equipmentType: DiscoveryDeviceType;
  externalEquipmentId: string;
  externalParentId?: string;
  externalName: string;
  externalAddress?: string;
  productExternalId?: string;
  metadata?: Record<string, unknown>;
}

export interface DeviceDiscoveryProvider {
  discover(): Promise<DiscoveredDevice[]>;
}

/** Read-only, in-process Phase 3 fixture. It performs no network or hardware I/O. */
export class SimulatorDiscoveryProvider implements DeviceDiscoveryProvider {
  async discover(): Promise<DiscoveredDevice[]> {
    return [
      ...['PUMP-01', 'PUMP-02', 'PUMP-03'].map((id, index) => ({ equipmentType: 'PUMP' as const, externalEquipmentId: id, externalName: `Simulator Pump ${index + 1}`, externalAddress: String(index + 1) })),
      { equipmentType: 'NOZZLE', externalEquipmentId: 'PUMP-01-N1', externalParentId: 'PUMP-01', externalName: 'Pump 1 Nozzle 1', externalAddress: '1.1', productExternalId: 'PMS' },
      { equipmentType: 'NOZZLE', externalEquipmentId: 'PUMP-01-N2', externalParentId: 'PUMP-01', externalName: 'Pump 1 Nozzle 2', externalAddress: '1.2', productExternalId: 'AGO' },
      { equipmentType: 'NOZZLE', externalEquipmentId: 'PUMP-02-N1', externalParentId: 'PUMP-02', externalName: 'Pump 2 Nozzle 1', externalAddress: '2.1', productExternalId: 'PMS' },
      { equipmentType: 'NOZZLE', externalEquipmentId: 'PUMP-02-N2', externalParentId: 'PUMP-02', externalName: 'Pump 2 Nozzle 2', externalAddress: '2.2', productExternalId: 'DPK' },
      { equipmentType: 'TANK', externalEquipmentId: 'TANK-01', externalName: 'Simulator Tank 1', externalAddress: 'T1', productExternalId: 'PMS' },
      { equipmentType: 'TANK', externalEquipmentId: 'TANK-02', externalName: 'Simulator Tank 2', externalAddress: 'T2', productExternalId: 'AGO' },
      { equipmentType: 'PRODUCT', externalEquipmentId: 'PMS', externalName: 'Premium Motor Spirit' },
      { equipmentType: 'PRODUCT', externalEquipmentId: 'AGO', externalName: 'Automotive Gas Oil' },
      { equipmentType: 'PRODUCT', externalEquipmentId: 'DPK', externalName: 'Dual Purpose Kerosene' },
    ];
  }
}
