import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { SimulatorDiscoveryProvider, type DiscoveryDeviceType, type DiscoveredDevice } from '../discovery/simulator-discovery-provider.js';

export type MappingStatus = 'MAPPED' | 'DISABLED' | 'CONFLICT' | 'ORPHANED';
export interface MappingInput { controllerId: string; stationId?: string; equipmentType: DiscoveryDeviceType; externalEquipmentId: string; externalParentId?: string; targetId: string; }

const parseJson = (value: unknown) => { try { return JSON.parse(String(value || '{}')); } catch { return {}; } };
const mapRow = (row: any) => row && ({ ...row, metadata: parseJson(row.metadata_json), metadata_json: undefined });

export class MappingService {
  constructor(private sqlite: Database.Database, private audit: (...args: any[]) => unknown) {}

  list() {
    return (this.sqlite.prepare(`SELECT m.*, c.name controller_name,
      COALESCE(p.pump_name, n.nozzle_name, t.tank_name, fp.name) target_name
      FROM automation_device_mappings m JOIN automation_controllers c ON c.id=m.controller_id
      LEFT JOIN pumps p ON p.id=m.pump_id LEFT JOIN pump_nozzles n ON n.id=m.nozzle_id
      LEFT JOIN fuel_tanks t ON t.id=m.tank_id LEFT JOIN fuel_products fp ON fp.id=m.product_id
      ORDER BY m.updated_at DESC`).all() as any[]).map(mapRow);
  }
  get(id: string) { return mapRow(this.sqlite.prepare('SELECT * FROM automation_device_mappings WHERE id=?').get(id)); }

  async discover(controllerId: string, providedDevices?: DiscoveredDevice[]) {
    const controller = this.sqlite.prepare('SELECT * FROM automation_controllers WHERE id=?').get(controllerId) as any;
    if (!controller) throw new Error('Controller does not exist.');
    const simulator=controller.adapter_type==='SIMULATOR'&&controller.connection_type==='SIMULATOR';
    if (!simulator && controller.adapter_type!=='PTS2') throw new Error('Discovery is unavailable for this controller type.');
    if (!simulator && !providedDevices) throw new Error('PTS-2 must be connected before read-only discovery.');
    const devices = providedDevices ?? await new SimulatorDiscoveryProvider().discover();
    const now = new Date().toISOString();
    this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE automation_discovered_devices SET present=0 WHERE controller_id=?').run(controllerId);
      const upsert = this.sqlite.prepare(`INSERT INTO automation_discovered_devices
        (id,controller_id,equipment_type,external_parent_id,external_equipment_id,external_name,external_address,product_external_id,metadata_json,first_discovered_at,last_discovered_at,present)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(controller_id,equipment_type,external_parent_id,external_equipment_id)
        DO UPDATE SET external_name=excluded.external_name,external_address=excluded.external_address,product_external_id=excluded.product_external_id,metadata_json=excluded.metadata_json,last_discovered_at=excluded.last_discovered_at,present=1`);
      for (const device of devices) upsert.run(randomUUID(), controllerId, device.equipmentType, device.externalParentId || '', device.externalEquipmentId, device.externalName, device.externalAddress || null, device.productExternalId || null, JSON.stringify(device.metadata || {}), now, now);
      this.sqlite.prepare(`UPDATE automation_device_mappings SET last_discovered_at=?, updated_at=updated_at WHERE controller_id=? AND EXISTS
        (SELECT 1 FROM automation_discovered_devices d WHERE d.controller_id=automation_device_mappings.controller_id AND d.equipment_type=automation_device_mappings.equipment_type AND d.external_parent_id=automation_device_mappings.external_parent_id AND d.external_equipment_id=automation_device_mappings.external_equipment_id AND d.present=1)`).run(now, controllerId);
    })();
    return this.discovered(controllerId);
  }

  discovered(controllerId?: string) {
    const rows = this.sqlite.prepare(`SELECT d.*, m.id mapping_id, m.status mapping_status,
      COALESCE(p.pump_name,n.nozzle_name,t.tank_name,fp.name) target_name
      FROM automation_discovered_devices d LEFT JOIN automation_device_mappings m
      ON m.controller_id=d.controller_id AND m.equipment_type=d.equipment_type AND m.external_parent_id=d.external_parent_id AND m.external_equipment_id=d.external_equipment_id
      LEFT JOIN pumps p ON p.id=m.pump_id LEFT JOIN pump_nozzles n ON n.id=m.nozzle_id
      LEFT JOIN fuel_tanks t ON t.id=m.tank_id LEFT JOIN fuel_products fp ON fp.id=m.product_id
      WHERE (? IS NULL OR d.controller_id=?) ORDER BY d.equipment_type,d.external_equipment_id`).all(controllerId || null, controllerId || null) as any[];
    return rows.map((row) => ({ ...mapRow(row), display_status: row.mapping_status || 'UNMAPPED' }));
  }

  equipment(stationId?: string) {
    const controllers = stationId ? this.sqlite.prepare('SELECT id FROM automation_controllers WHERE station_id=?').all(stationId) as any[] : [];
    const ids = controllers.map((row) => row.id);
    const mappings = this.list().filter((m: any) => !stationId || ids.includes(m.controller_id));
    const byTarget = new Map(mappings.filter((m: any) => m.status === 'MAPPED').map((m: any) => [m.pump_id || m.nozzle_id || m.tank_id || m.product_id, m]));
    const pumps = this.sqlite.prepare('SELECT * FROM pumps ORDER BY pump_number').all() as any[];
    const nozzles = this.sqlite.prepare(`SELECT n.*, fp.name product_name, fp.code product_code FROM pump_nozzles n LEFT JOIN fuel_products fp ON fp.id=n.fuel_product_id ORDER BY n.physical_pump_id,n.nozzle_number`).all() as any[];
    return {
      pumps: pumps.map((pump) => ({ ...pump, mapping: byTarget.get(pump.id) || null, connectionStatus: 'UNKNOWN', nozzles: nozzles.filter((n) => n.physical_pump_id === pump.id).map((n) => ({ ...n, mapping: byTarget.get(n.id) || null, connectionStatus: 'UNKNOWN' })) })),
      tanks: (this.sqlite.prepare('SELECT * FROM fuel_tanks ORDER BY tank_name').all() as any[]).map((row) => ({ ...row, mapping: byTarget.get(row.id) || null })),
      products: (this.sqlite.prepare('SELECT * FROM fuel_products ORDER BY name').all() as any[]).map((row) => ({ ...row, mapping: byTarget.get(row.id) || null })),
    };
  }

  validate(input: MappingInput, excludeId?: string) {
    const parent = input.externalParentId || '';
    const controller = this.sqlite.prepare('SELECT * FROM automation_controllers WHERE id=?').get(input.controllerId) as any;
    if (!controller) throw new Error('Invalid controller.');
    if (!this.sqlite.prepare('SELECT 1 FROM station_settings WHERE id=?').get(controller.station_id)) throw new Error('Controller station is invalid.');
    if (input.stationId && input.stationId !== controller.station_id) throw new Error('Controller and requested station do not match.');
    const discovered = this.sqlite.prepare(`SELECT * FROM automation_discovered_devices WHERE controller_id=? AND equipment_type=? AND external_parent_id=? AND external_equipment_id=?`).get(input.controllerId,input.equipmentType,parent,input.externalEquipmentId) as any;
    if (!discovered) throw new Error('External device has not been discovered for this controller.');
    const target = this.target(input.equipmentType, input.targetId);
    if (!target) throw new Error(`DEITAX FMS.A ${input.equipmentType.toLowerCase()} does not exist.`);
    if ((input.equipmentType === 'PUMP' || input.equipmentType === 'NOZZLE') && String(target.status).toUpperCase() !== 'ACTIVE') throw new Error('The selected DEITAX FMS.A equipment is disabled or unavailable.');
    const duplicateExternal = this.sqlite.prepare(`SELECT id FROM automation_device_mappings WHERE controller_id=? AND equipment_type=? AND external_parent_id=? AND external_equipment_id=? AND id<>?`).get(input.controllerId,input.equipmentType,parent,input.externalEquipmentId,excludeId || '') as any;
    if (duplicateExternal) throw new Error('This external device already has a mapping.');
    const targetColumn = {PUMP:'pump_id',NOZZLE:'nozzle_id',TANK:'tank_id',PRODUCT:'product_id'}[input.equipmentType];
    const conflict = this.sqlite.prepare(`SELECT id FROM automation_device_mappings WHERE ${targetColumn}=? AND status='MAPPED' AND id<>?`).get(input.targetId,excludeId || '') as any;
    if (conflict) throw new Error('The selected DEITAX FMS.A equipment is already actively mapped.');
    if (input.equipmentType === 'NOZZLE') {
      if (!parent) throw new Error('External nozzle is missing its external pump relationship.');
      const pumpMapping = this.sqlite.prepare(`SELECT pump_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type='PUMP' AND external_equipment_id=? AND status='MAPPED'`).get(input.controllerId,parent) as any;
      if (!pumpMapping) throw new Error('Map the external parent pump before mapping its nozzle.');
      if (target.physical_pump_id !== pumpMapping.pump_id) throw new Error('The DEITAX FMS.A nozzle does not belong to the mapped physical pump.');
      if (!this.sqlite.prepare('SELECT 1 FROM fuel_products WHERE id=?').get(target.fuel_product_id)) throw new Error('The nozzle product assignment is missing or invalid.');
      if (discovered.product_external_id) {
        const productMapping = this.sqlite.prepare(`SELECT product_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type='PRODUCT' AND external_equipment_id=? AND status='MAPPED'`).get(input.controllerId,discovered.product_external_id) as any;
        if (productMapping && productMapping.product_id !== target.fuel_product_id) throw new Error('External and DEITAX FMS.A nozzle product assignments conflict.');
      }
    }
    if (input.equipmentType === 'TANK' && discovered.product_external_id) {
      const productMapping = this.sqlite.prepare(`SELECT product_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type='PRODUCT' AND external_equipment_id=? AND status='MAPPED'`).get(input.controllerId,discovered.product_external_id) as any;
      if (productMapping && productMapping.product_id !== target.fuel_product_id) throw new Error('External and DEITAX FMS.A tank products conflict.');
    }
    return { valid: true, controller, discovered, target };
  }

  create(input: MappingInput, actor: any) {
    const checked = this.validate(input); const now = new Date().toISOString(); const id = randomUUID();
    const columns = {PUMP:'pump_id',NOZZLE:'nozzle_id',TANK:'tank_id',PRODUCT:'product_id'} as const;
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO automation_device_mappings (id,controller_id,equipment_type,external_parent_id,external_equipment_id,external_name,external_address,metadata_json,${columns[input.equipmentType]},status,created_by,last_discovered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'MAPPED',?,?,?,?)`)
        .run(id,input.controllerId,input.equipmentType,input.externalParentId||'',input.externalEquipmentId,checked.discovered.external_name,checked.discovered.external_address,checked.discovered.metadata_json,input.targetId,actor.id,checked.discovered.last_discovered_at,now,now);
      const after=this.get(id); this.history(id,input.controllerId,'CREATED',null,after,actor.id);
    })();
    const result=this.get(id); this.requeueResolvedPts2Sales(input.controllerId); this.logAudit(actor,'MAPPING_CREATED',result); return result;
  }

  update(id: string, input: MappingInput, actor: any) {
    const before=this.get(id); if(!before) throw new Error('Mapping not found.'); this.validate(input,id); const columns={PUMP:'pump_id',NOZZLE:'nozzle_id',TANK:'tank_id',PRODUCT:'product_id'} as const; const now=new Date().toISOString();
    this.sqlite.transaction(()=>{ this.sqlite.prepare(`UPDATE automation_device_mappings SET controller_id=?,equipment_type=?,external_parent_id=?,external_equipment_id=?,pump_id=NULL,nozzle_id=NULL,tank_id=NULL,product_id=NULL,${columns[input.equipmentType]}=?,status='MAPPED',updated_at=? WHERE id=?`).run(input.controllerId,input.equipmentType,input.externalParentId||'',input.externalEquipmentId,input.targetId,now,id); this.history(id,input.controllerId,'UPDATED',before,this.get(id),actor.id); })();
    const result=this.get(id); this.requeueResolvedPts2Sales(input.controllerId); this.logAudit(actor,`${input.equipmentType}_MAPPING_CHANGED`,result); return result;
  }

  setEnabled(id: string, enabled: boolean, actor: any) {
    const before=this.get(id); if(!before) throw new Error('Mapping not found.'); if(enabled) this.validate({controllerId:before.controller_id,equipmentType:before.equipment_type,externalEquipmentId:before.external_equipment_id,externalParentId:before.external_parent_id,targetId:before.pump_id||before.nozzle_id||before.tank_id||before.product_id},id);
    const status=enabled?'MAPPED':'DISABLED'; this.sqlite.transaction(()=>{this.sqlite.prepare('UPDATE automation_device_mappings SET status=?,updated_at=? WHERE id=?').run(status,new Date().toISOString(),id);this.history(id,before.controller_id,enabled?'RESTORED':'DISABLED',before,this.get(id),actor.id);})();
    const result=this.get(id);if(enabled)this.requeueResolvedPts2Sales(before.controller_id);this.logAudit(actor,enabled?'MAPPING_RESTORED':'MAPPING_DISABLED',result);return result;
  }
  historyFor(id:string){return this.sqlite.prepare('SELECT h.*,u.name changed_by_name FROM automation_mapping_history h JOIN users u ON u.id=h.changed_by WHERE mapping_id=? ORDER BY created_at DESC').all(id);}
  private target(type:DiscoveryDeviceType,id:string){const table={PUMP:'pumps',NOZZLE:'pump_nozzles',TANK:'fuel_tanks',PRODUCT:'fuel_products'}[type];return this.sqlite.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;}
  private requeueResolvedPts2Sales(controllerId:string){
    if(!this.sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_fuel_transaction_processing'`).get())return 0;
    return this.sqlite.transaction(()=>{
      const rows=this.sqlite.prepare(`SELECT p.inbox_id FROM automation_fuel_transaction_processing p
        JOIN automation_event_inbox i ON i.id=p.inbox_id
        JOIN automation_device_mappings pm ON pm.controller_id=p.controller_id AND pm.equipment_type='PUMP' AND pm.external_equipment_id=p.external_parent_id AND pm.status='MAPPED'
        JOIN automation_device_mappings nm ON nm.controller_id=p.controller_id AND nm.equipment_type='NOZZLE' AND nm.external_parent_id=p.external_parent_id AND nm.external_equipment_id=p.external_device_id AND nm.status='MAPPED'
        WHERE p.controller_id=? AND p.processing_status='REJECTED' AND p.failure_code IN('DEVICE_NOT_MAPPED','NOZZLE_NOT_FOUND')
          AND i.external_event_id LIKE 'pts2-sale:%' AND json_extract(i.payload_json,'$.readOnlySource')=1`).all(controllerId) as Array<{inbox_id:string}>;
      const processing=this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET processing_status='RECEIVED',failure_code=NULL,failure_class=NULL,failure_detail=NULL,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`);
      const inbox=this.sqlite.prepare(`UPDATE automation_event_inbox SET processing_status='RECEIVED',processing_attempts=0,processed_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`);
      for(const row of rows){processing.run(row.inbox_id);inbox.run(row.inbox_id);}
      return rows.length;
    })();
  }
  private history(mappingId:string,controllerId:string,action:string,before:any,after:any,userId:string){this.sqlite.prepare('INSERT INTO automation_mapping_history (id,mapping_id,controller_id,action,before_json,after_json,changed_by) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),mappingId,controllerId,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null,userId);}
  private logAudit(actor:any,action:string,mapping:any){this.audit(actor.id,actor.name,actor.role,action,'Automation',`${mapping.equipment_type} mapping ${mapping.external_equipment_id} → ${mapping.pump_id||mapping.nozzle_id||mapping.tank_id||mapping.product_id} (${mapping.status}).`);}
}
