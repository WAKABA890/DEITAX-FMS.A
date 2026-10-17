import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/** Append-only evidence. A dip is an observation, never an inventory update. */
export function ensureTankStockSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS tank_stock_ledger (
    id TEXT PRIMARY KEY, tank_id TEXT NOT NULL REFERENCES fuel_tanks(id), product_id TEXT NOT NULL,
    movement_type TEXT NOT NULL, quantity REAL NOT NULL, before_balance REAL NOT NULL, after_balance REAL NOT NULL,
    source TEXT NOT NULL, reference TEXT, actor_id TEXT NOT NULL, station_id TEXT, shift_id TEXT,
    transaction_id TEXT UNIQUE, controller_id TEXT, external_event_id TEXT, delivery_id TEXT, dip_id TEXT,
    occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, anomaly TEXT,
    UNIQUE(controller_id,external_event_id)
  );
  CREATE TABLE IF NOT EXISTS manual_tank_dips (
    id TEXT PRIMARY KEY, tank_id TEXT NOT NULL REFERENCES fuel_tanks(id), product_id TEXT NOT NULL,
    dip_value REAL NOT NULL, dip_unit TEXT NOT NULL, volume_liters REAL NOT NULL,
    expected_balance REAL NOT NULL, variance_liters REAL NOT NULL, resulting_balance REAL NOT NULL,
    occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id TEXT NOT NULL, station_id TEXT NOT NULL, shift_id TEXT, reason TEXT NOT NULL, reference TEXT
  );
  INSERT OR IGNORE INTO tank_stock_ledger(id,tank_id,product_id,movement_type,quantity,before_balance,after_balance,source,actor_id,occurred_at,anomaly)
    SELECT 'opening:'||id,id,fuel_product_id,'TANK_OPENING_BALANCE',current_level_liters,0,current_level_liters,'EXISTING_FMS_BALANCE','SYSTEM',CURRENT_TIMESTAMP,'BASE_BALANCE_REQUIRES_REVIEW' FROM fuel_tanks;
  CREATE TRIGGER IF NOT EXISTS tank_opening_ledger AFTER INSERT ON fuel_tanks BEGIN
    INSERT INTO tank_stock_ledger(id,tank_id,product_id,movement_type,quantity,before_balance,after_balance,source,actor_id,occurred_at)
    VALUES('opening:'||NEW.id,NEW.id,NEW.fuel_product_id,'TANK_OPENING_BALANCE',NEW.current_level_liters,0,NEW.current_level_liters,'FMS_TANK_CREATION','SYSTEM',CURRENT_TIMESTAMP);
  END;
  DROP TRIGGER IF EXISTS tank_adjustment_ledger;
  CREATE TRIGGER IF NOT EXISTS tank_adjustment_ledger AFTER INSERT ON stock_adjustments WHEN NEW.type='Fuel' AND COALESCE(NEW.reason,'') NOT IN ('Fuel Delivery','Credit Note RTT Return to Tank','PTS-2 Fuel Sale') BEGIN
    INSERT INTO tank_stock_ledger(id,tank_id,product_id,movement_type,quantity,before_balance,after_balance,source,reference,actor_id,occurred_at)
    SELECT 'adjustment:'||NEW.id,t.id,t.fuel_product_id,CASE WHEN NEW.reason='Fuel Delivery' THEN 'FUEL_DELIVERY' ELSE 'STOCK_ADJUSTMENT' END,NEW.adjustment_quantity,NEW.previous_quantity,NEW.new_quantity,'FMS_STOCK_ADJUSTMENT',COALESCE(NEW.reference_number,NEW.id),COALESCE(NEW.recorded_by,'SYSTEM'),NEW.created_at FROM fuel_tanks t WHERE t.id=NEW.reference_id;
  END;
  CREATE INDEX IF NOT EXISTS idx_tank_dips_time ON manual_tank_dips(tank_id,occurred_at);
  CREATE INDEX IF NOT EXISTS idx_tank_ledger_time ON tank_stock_ledger(tank_id,occurred_at);
  CREATE TRIGGER IF NOT EXISTS manual_tank_dips_no_update BEFORE UPDATE ON manual_tank_dips BEGIN SELECT RAISE(ABORT,'Manual dip evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS manual_tank_dips_no_delete BEFORE DELETE ON manual_tank_dips BEGIN SELECT RAISE(ABORT,'Manual dip evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS tank_stock_ledger_no_update BEFORE UPDATE ON tank_stock_ledger BEGIN SELECT RAISE(ABORT,'Tank stock ledger is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS tank_stock_ledger_no_delete BEFORE DELETE ON tank_stock_ledger BEGIN SELECT RAISE(ABORT,'Tank stock ledger is immutable'); END;`);
}

export function recordManualTankDip(db: Database.Database, input: {
  tankId:string; dipValue:number; dipUnit:string; volumeLiters:number; occurredAt:string;
  actorId:string; stationId:string; shiftId?:string|null; reason:string; reference?:string; setInitialStock?:boolean;
}) {
  if (![input.dipValue,input.volumeLiters].every(v=>Number.isFinite(v)&&v>=0) || !['MM','CM','L'].includes(input.dipUnit)) throw new Error('A non-negative dip and volume with unit MM, CM or L are required.');
  if (!input.reason.trim() || !input.actorId || !input.stationId || !Number.isFinite(Date.parse(input.occurredAt)) || Date.parse(input.occurredAt)>Date.now()+300000) throw new Error('Valid reading time, actor, station and reason are required.');
  return db.transaction(()=>{
    const tank=db.prepare('SELECT * FROM fuel_tanks WHERE id=?').get(input.tankId) as any;
    if(!tank)throw new Error('Tank not found.');
    if(input.volumeLiters>tank.capacity_liters)throw new Error('Entered volume exceeds tank capacity.');
    const expected=Number(tank.current_level_liters),initialSetup=input.setInitialStock===true,resulting=initialSetup?input.volumeLiters:expected,variance=initialSetup?0:Number((input.volumeLiters-expected).toFixed(3)),id=randomUUID();
    db.prepare(`INSERT INTO manual_tank_dips(id,tank_id,product_id,dip_value,dip_unit,volume_liters,expected_balance,variance_liters,resulting_balance,occurred_at,actor_id,station_id,shift_id,reason,reference) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,tank.id,tank.fuel_product_id,input.dipValue,input.dipUnit,input.volumeLiters,expected,variance,resulting,input.occurredAt,input.actorId,input.stationId,input.shiftId||null,input.reason,input.reference||null);
    db.prepare(`INSERT INTO tank_stock_ledger(id,tank_id,product_id,movement_type,quantity,before_balance,after_balance,source,reference,actor_id,station_id,shift_id,dip_id,occurred_at,anomaly) VALUES(?,?,?, ?,?,?,?,'MANUAL_DIP',?,?,?,?,?,?,?)`).run(randomUUID(),tank.id,tank.fuel_product_id,initialSetup?'TANK_OPENING_BALANCE':'MANUAL_DIP',initialSetup?Number((resulting-expected).toFixed(3)):0,expected,resulting,input.reference||null,input.actorId,input.stationId,input.shiftId||null,id,input.occurredAt,initialSetup?'INITIAL_STOCK_SET':Math.abs(variance)>0.0005?'DIP_VARIANCE':null);
    if(initialSetup) db.prepare('UPDATE fuel_tanks SET current_level_liters=?,last_dip_reading=?,last_dip_time=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(resulting,input.volumeLiters,input.occurredAt,tank.id);
    else db.prepare('UPDATE fuel_tanks SET last_dip_reading=?,last_dip_time=? WHERE id=? AND (last_dip_time IS NULL OR last_dip_time<=?)').run(input.volumeLiters,input.occurredAt,tank.id,input.occurredAt);
    return {id,tankId:tank.id,reportedValue:input.volumeLiters,authoritativeValue:expected,variance,resultingBalance:resulting,initialSetup,recordedAt:input.occurredAt,shiftId:input.shiftId||null};
  })();
}

function recordPts2FuelSaleStockAudit(db: Database.Database, tank: any, input: {
  productId: string; quantity: number; transactionId: string; controllerId: string; eventId: string; occurredAt: string;
  receiptNumber?: string | null; pumpName?: string | null; nozzleName?: string | null;
}, before: number, after: number) {
  const product = db.prepare('SELECT code,name FROM fuel_products WHERE id=?').get(input.productId) as any;
  const reference = input.receiptNumber || 'PTS2-' + input.eventId;
  const productName = product?.name || tank.fuel_name || input.productId;
  const productCode = product?.code || null;
  const location = [input.pumpName, input.nozzleName].filter(Boolean).join(' / ');
  const note = [
    'PTS-2 fuel dispense',
    'Tank: ' + (tank.tank_name || tank.id),
    'Product: ' + productName,
    location ? 'Nozzle: ' + location : null,
    'Dispensed: ' + input.quantity.toFixed(3) + ' L',
    'Stock: ' + before.toFixed(3) + ' L to ' + after.toFixed(3) + ' L',
    'PTS-2 event: ' + input.eventId,
  ].filter(Boolean).join(' | ');

  db.prepare(`INSERT OR IGNORE INTO stock_adjustments(
    id,type,reference_id,reference_name,previous_quantity,adjustment_quantity,new_quantity,
    reason,movement_type,source,reference_number,original_document_number,product_code,
    performed_by,recorded_by,recorded_by_name,notes,created_at,updated_at
  ) VALUES(?, 'Fuel', ?, ?, ?, ?, ?, 'PTS-2 Fuel Sale', 'SALE', 'PTS-2 Transaction', ?, ?, ?, 'PTS-2 Controller', NULL, 'Automation Runtime', ?, ?, ?)`)
    .run(
      'pts2-stock-' + input.transactionId,
      tank.id,
      tank.tank_name || tank.id,
      before,
      -input.quantity,
      after,
      reference,
      reference,
      productCode,
      note,
      input.occurredAt,
      input.occurredAt,
    );
}

/** Idempotently projects existing PTS-2 tank movements into Stock & Inventory Audit. */
export function backfillPts2FuelSaleStockAudits(db: Database.Database) {
  const rows = db.prepare(`SELECT
      l.transaction_id, l.tank_id, l.product_id, l.quantity, l.before_balance, l.after_balance,
      l.reference, l.controller_id, l.external_event_id, l.occurred_at,
      t.tank_name, t.fuel_name, p.code AS product_code, p.name AS product_name,
      tx.receipt_number, pump.pump_name, nozzle.nozzle_name
    FROM tank_stock_ledger l
    JOIN fuel_tanks t ON t.id=l.tank_id
    LEFT JOIN fuel_products p ON p.id=l.product_id
    LEFT JOIN transactions tx ON tx.id=l.transaction_id
    LEFT JOIN pump_nozzles nozzle ON nozzle.id=tx.nozzle_id
    LEFT JOIN pumps pump ON pump.id=tx.pump_id
    LEFT JOIN stock_adjustments a ON a.id='pts2-stock-' || l.transaction_id
    WHERE l.movement_type='PTS2_FUEL_SALE'
      AND l.transaction_id IS NOT NULL
      AND a.id IS NULL`).all() as any[];

  const write = db.transaction((items: any[]) => {
    for (const row of items) {
      const quantity = Math.abs(Number(row.quantity));
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      recordPts2FuelSaleStockAudit(db, {
        id: row.tank_id,
        tank_name: row.tank_name,
        fuel_name: row.fuel_name,
      }, {
        productId: row.product_id,
        quantity,
        transactionId: row.transaction_id,
        controllerId: row.controller_id || 'PTS2',
        eventId: row.external_event_id || row.reference || row.transaction_id,
        occurredAt: row.occurred_at,
        receiptNumber: row.receipt_number,
        pumpName: row.pump_name,
        nozzleName: row.nozzle_name,
      }, Number(row.before_balance), Number(row.after_balance));
    }
    return items.length;
  });
  return write(rows);
}

/** Called inside the sale posting transaction; its failure rolls back the receipt too. */
export function deductPts2TankStock(db:Database.Database,input:{tankId:string;productId:string;quantity:number;transactionId:string;controllerId:string;eventId:string;stationId:string;shiftId:string|null;occurredAt:string;receiptNumber?:string|null;pumpName?:string|null;nozzleName?:string|null}) {
  const tank=db.prepare('SELECT * FROM fuel_tanks WHERE id=?').get(input.tankId) as any;
  if(!tank||tank.fuel_product_id!==input.productId)throw new Error('PTS2_TANK_MAPPING_REQUIRED');
  if(!Number.isFinite(input.quantity)||input.quantity<=0)throw new Error('Invalid sale litres');
  if(db.prepare('SELECT 1 FROM tank_stock_ledger WHERE transaction_id=? OR (controller_id=? AND external_event_id=?)').get(input.transactionId,input.controllerId,input.eventId))return;
  const before=Number(tank.current_level_liters),after=Number((before-input.quantity).toFixed(3));
  if(!Number.isFinite(before))throw new Error('Invalid tank balance');
  db.prepare('UPDATE fuel_tanks SET current_level_liters=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(after,tank.id);
  db.prepare(`INSERT INTO tank_stock_ledger(id,tank_id,product_id,movement_type,quantity,before_balance,after_balance,source,reference,actor_id,station_id,shift_id,transaction_id,controller_id,external_event_id,occurred_at,anomaly) VALUES(?,?,?,'PTS2_FUEL_SALE',?,?,?,'PTS2',?,'AUTOMATION',?,?,?,?,?,?,?)`).run(randomUUID(),tank.id,input.productId,-input.quantity,before,after,input.eventId,input.stationId,input.shiftId,input.transactionId,input.controllerId,input.eventId,input.occurredAt,after<0?'NEGATIVE_STOCK_REVIEW_REQUIRED':null);
  recordPts2FuelSaleStockAudit(db, tank, input, before, after);
  return {before,after,anomaly:after<0?'NEGATIVE_STOCK_REVIEW_REQUIRED':null};
}
