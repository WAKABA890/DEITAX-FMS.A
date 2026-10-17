import { deductPts2TankStock } from '../tank-stock.js';
import { nextReceiptNumber } from '../../utils/document-sequence.ts';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AutomationEventEnvelope } from '../types/events.js';

export type FuelTransactionFailureCode =
  | 'INVALID_TRANSACTION_STATUS' | 'PTS2_TANK_MAPPING_REQUIRED' | 'CONTROLLER_NOT_FOUND'|'CONTROLLER_DISABLED'|'DEVICE_NOT_MAPPED'|'PUMP_NOT_FOUND'|'NOZZLE_NOT_FOUND'
  | 'NOZZLE_PUMP_MISMATCH'|'PRODUCT_MISMATCH'|'INVALID_QUANTITY'|'INVALID_PRICE'|'INVALID_AMOUNT'
  | 'INVALID_TIMESTAMP'|'STATION_MISMATCH'|'DUPLICATE_EVENT'|'EVENT_ALREADY_PROCESSED'
  | 'MISSING_REQUIRED_FIELD'|'EVENT_INTEGRITY_FAILURE'|'DATABASE_FAILURE';

export interface FuelTransactionProcessingResult {
  outcome:'IGNORED'|'POSTED'|'REJECTED'|'DUPLICATE';
  transactionId?:string;
  failureCode?:FuelTransactionFailureCode;
}

class PermanentFailure extends Error {
  readonly code:FuelTransactionFailureCode;
  constructor(code:FuelTransactionFailureCode,message:string){super(message);this.code=code;}
}

const finite=(value:unknown)=>typeof value==='number'?value:Number(value);
const normalized=(value:unknown)=>String(value??'').trim().toUpperCase();
const decimalPlaces=(value:number)=>{const text=String(value);if(/[eE]/.test(text))return 10;return(text.split('.')[1]||'').length;};

/** Phase 6 only: validates and posts completed dispensing events. */
export class AutomatedFuelTransactionEngine {
  private sqlite:Database.Database;
  constructor(sqlite:Database.Database){this.sqlite=sqlite;}

  /** Upgrade only validated, posted PTS-2 captures; keep their evidence and amounts. */
  completePendingPts2Receipts(): number {
    return this.sqlite.transaction(() => {
      const pending = this.sqlite.prepare(`SELECT t.id,t.date,t.total_amount,t.payment_method,p.controller_id,p.inbox_id FROM transactions t JOIN automation_fuel_transaction_processing p ON p.transaction_id=t.id JOIN automation_controllers c ON c.id=p.controller_id WHERE c.adapter_type='PTS2' AND p.processing_status='POSTED' AND t.source='AUTOMATION' AND t.status='Payment Pending' AND t.receipt_number IS NULL`).all() as any[];
      for (const tx of pending) {
        const receipt = nextReceiptNumber(this.sqlite);
        this.sqlite.prepare("UPDATE transactions SET status='Completed',document_type='Receipt',receipt_number=?,notes=COALESCE(notes,'')||'; PTS-2 completed sale: receipt issued automatically',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Payment Pending'").run(receipt,tx.id);
        this.recordPts2CashFlowInflow({id:tx.id,date:tx.date,amount:tx.total_amount,paymentMethod:tx.payment_method,receiptNumber:receipt});
        this.sqlite.prepare("INSERT INTO automation_logs(id,controller_id,event_id,timestamp,level,category,message,details_json) VALUES(?,?,?,CURRENT_TIMESTAMP,'INFO','PTS2_RECEIPT_CREATED','Existing completed PTS-2 capture issued a receipt.',?)").run(randomUUID(),tx.controller_id,tx.inbox_id,JSON.stringify({transactionId:tx.id,receiptNumber:receipt}));
      }
      return pending.length;
    })();
  }

  /** Restores missing ledger entries for PTS-2 sales posted before inflow capture existed. */
  backfillPts2CashFlowInflows(): number {
    return this.sqlite.transaction(() => {
      const sales = this.sqlite.prepare(`SELECT t.id,t.date,t.total_amount,t.payment_method,t.receipt_number FROM transactions t JOIN automation_fuel_transaction_processing p ON p.transaction_id=t.id JOIN automation_controllers c ON c.id=p.controller_id WHERE c.adapter_type='PTS2' AND p.processing_status='POSTED' AND t.source='AUTOMATION' AND t.status='Completed' AND t.receipt_number IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cash_flow_records f WHERE f.related_transaction_id=t.id)`).all() as any[];
      for (const sale of sales)this.recordPts2CashFlowInflow({id:sale.id,date:sale.date,amount:sale.total_amount,paymentMethod:sale.payment_method,receiptNumber:sale.receipt_number});
      return sales.length;
    })();
  }

  /** Requeues PTS-2 sales rejected by the former local-price equality rule. */
  requeueTrustedPts2PriceRejects():number {
    return this.sqlite.transaction(()=>{
      const rows=this.sqlite.prepare(`SELECT p.inbox_id FROM automation_fuel_transaction_processing p JOIN automation_event_inbox i ON i.id=p.inbox_id WHERE p.processing_status='REJECTED' AND p.failure_code='INVALID_PRICE' AND i.external_event_id LIKE 'pts2-sale:%' AND json_extract(i.payload_json,'$.readOnlySource')=1`).all() as Array<{inbox_id:string}>;
      const resetProcessing=this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET processing_status='RECEIVED',failure_code=NULL,failure_class=NULL,failure_detail=NULL,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`);
      const resetInbox=this.sqlite.prepare(`UPDATE automation_event_inbox SET processing_status='RECEIVED',processing_attempts=0,processed_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`);
      for(const row of rows){resetProcessing.run(row.inbox_id);resetInbox.run(row.inbox_id);}
      return rows.length;
    })();
  }

  /** Replays trusted PTS-2 sales once their exact pump and nozzle mappings exist. */
  requeueResolvedPts2MappingRejects():number {
    return this.sqlite.transaction(()=>{
      const rows=this.sqlite.prepare(`SELECT p.inbox_id FROM automation_fuel_transaction_processing p
        JOIN automation_event_inbox i ON i.id=p.inbox_id
        JOIN automation_device_mappings pm ON pm.controller_id=p.controller_id AND pm.equipment_type='PUMP' AND pm.external_equipment_id=p.external_parent_id AND pm.status='MAPPED'
        JOIN automation_device_mappings nm ON nm.controller_id=p.controller_id AND nm.equipment_type='NOZZLE' AND nm.external_parent_id=p.external_parent_id AND nm.external_equipment_id=p.external_device_id AND nm.status='MAPPED'
        WHERE p.processing_status='REJECTED' AND p.failure_code IN('DEVICE_NOT_MAPPED','NOZZLE_NOT_FOUND','PTS2_TANK_MAPPING_REQUIRED')
          AND i.external_event_id LIKE 'pts2-sale:%' AND json_extract(i.payload_json,'$.readOnlySource')=1`).all() as Array<{inbox_id:string}>;
      const resetProcessing=this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET processing_status='RECEIVED',failure_code=NULL,failure_class=NULL,failure_detail=NULL,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`);
      const resetInbox=this.sqlite.prepare(`UPDATE automation_event_inbox SET processing_status='RECEIVED',processing_attempts=0,processed_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`);
      for(const row of rows){resetProcessing.run(row.inbox_id);resetInbox.run(row.inbox_id);}
      return rows.length;
    })();
  }

  process(event:AutomationEventEnvelope,inboxId:string):FuelTransactionProcessingResult {
    if(event.eventType!=='DISPENSING_COMPLETED')return{outcome:'IGNORED'};
    const payload=(event.payload&&typeof event.payload==='object'?event.payload:{}) as Record<string,unknown>;
    const externalNozzleId=String(event.externalDeviceId||payload.externalNozzleId||'').trim();
    const externalPumpId=String(payload.externalPumpId||payload.pumpId||'').trim();
    this.sqlite.prepare(`INSERT OR IGNORE INTO automation_fuel_transaction_processing
      (inbox_id,controller_id,external_event_id,external_device_id,external_parent_id,source_sequence,occurred_at,received_at,processing_status)
      VALUES(?,?,?,?,?,?,?,?, 'RECEIVED')`).run(inboxId,event.controllerId,event.eventId,externalNozzleId||null,externalPumpId||null,event.sourceSequence||null,event.sourceOccurredAt,event.receivedAt);
    const existing=this.sqlite.prepare(`SELECT processing_status,transaction_id FROM automation_fuel_transaction_processing WHERE controller_id=? AND external_event_id=?`).get(event.controllerId,event.eventId) as any;
    if(existing?.processing_status==='POSTED')return{outcome:'DUPLICATE',transactionId:existing.transaction_id};
    if(existing?.processing_status==='REJECTED')return{outcome:'DUPLICATE'};
    try{
      this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET processing_status='VALIDATING',processing_attempts=processing_attempts+1,failure_code=NULL,failure_class=NULL,failure_detail=NULL,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(inboxId);
      const validated=this.validate(event,payload,inboxId,externalPumpId,externalNozzleId);
      this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET processing_status='VALIDATED',updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(inboxId);
      return this.post(event,inboxId,validated);
    }catch(error){
      if(error instanceof PermanentFailure){
        this.sqlite.transaction(()=>{
          this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET processing_status='REJECTED',failure_code=?,failure_class='PERMANENT',failure_detail=?,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(error.code,error.message.slice(0,1000),inboxId);
          this.sqlite.prepare(`UPDATE automation_event_inbox SET processing_status='PROCESSED',processed_at=CURRENT_TIMESTAMP,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(`${error.code}: ${error.message}`.slice(0,4000),inboxId);
          this.log(event,inboxId,'WARNING','FUEL_TRANSACTION_REJECTED',error.message,{failureCode:error.code});
        })();
        return{outcome:'REJECTED',failureCode:error.code};
      }
      const detail=error instanceof Error?error.message:String(error);
      try{this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET processing_status='FAILED',failure_code='DATABASE_FAILURE',failure_class='TEMPORARY',failure_detail=?,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(detail.slice(0,1000),inboxId);}catch{}
      throw error;
    }
  }

  private validate(event:AutomationEventEnvelope,payload:Record<string,unknown>,inboxId:string,externalPumpId:string,externalNozzleId:string){
    if(payload.status!=null&&!['COMPLETED','FINISHED'].includes(normalized(payload.status)))throw new PermanentFailure('INVALID_TRANSACTION_STATUS','Only a completed dispensing transaction may affect tank stock.');
    const inbox=this.sqlite.prepare('SELECT raw_payload_hash,event_type FROM automation_event_inbox WHERE id=?').get(inboxId) as any;
    if(!inbox||inbox.event_type!=='DISPENSING_COMPLETED')throw new PermanentFailure('EVENT_INTEGRITY_FAILURE','Inbox identity does not match a completed dispensing event.');
    const hash=createHash('sha256').update(JSON.stringify(event.payload)).digest('hex');
    if(hash!==inbox.raw_payload_hash)throw new PermanentFailure('EVENT_INTEGRITY_FAILURE','Stored event payload integrity check failed.');
    const controller=this.sqlite.prepare(`SELECT c.*,s.id station_exists FROM automation_controllers c LEFT JOIN station_settings s ON s.id=c.station_id WHERE c.id=?`).get(event.controllerId) as any;
    if(!controller)throw new PermanentFailure('CONTROLLER_NOT_FOUND','Controller does not exist.');
    if(!controller.station_exists)throw new PermanentFailure('STATION_MISMATCH','Controller station is unavailable.');
    if(!controller.enabled||controller.status==='DISABLED')throw new PermanentFailure('CONTROLLER_DISABLED','Controller is disabled.');
    if(payload.stationId&&String(payload.stationId)!==controller.station_id)throw new PermanentFailure('STATION_MISMATCH','Event station does not match the controller station.');
    if(!externalPumpId||!externalNozzleId)throw new PermanentFailure('MISSING_REQUIRED_FIELD','External pump and nozzle identities are required.');
    const pumpMap=this.sqlite.prepare(`SELECT * FROM automation_device_mappings WHERE controller_id=? AND equipment_type='PUMP' AND external_equipment_id=?`).get(event.controllerId,externalPumpId) as any;
    if(!pumpMap||pumpMap.status!=='MAPPED')throw new PermanentFailure('DEVICE_NOT_MAPPED','External pump has no active mapping.');
    const pump=this.sqlite.prepare('SELECT * FROM pumps WHERE id=?').get(pumpMap.pump_id) as any;
    if(!pump||pump.status!=='Active')throw new PermanentFailure('PUMP_NOT_FOUND','Mapped physical pump is unavailable or inactive.');
    const identifiedNozzleMap=this.sqlite.prepare(`SELECT * FROM automation_device_mappings WHERE controller_id=? AND equipment_type='NOZZLE' AND external_equipment_id=?`).get(event.controllerId,externalNozzleId) as any;
    if(identifiedNozzleMap&&identifiedNozzleMap.external_parent_id!==externalPumpId)throw new PermanentFailure('NOZZLE_PUMP_MISMATCH','External nozzle belongs to a different external pump.');
    const nozzleMap=this.sqlite.prepare(`SELECT * FROM automation_device_mappings WHERE controller_id=? AND equipment_type='NOZZLE' AND external_parent_id=? AND external_equipment_id=?`).get(event.controllerId,externalPumpId,externalNozzleId) as any;
    if(!nozzleMap||nozzleMap.status!=='MAPPED')throw new PermanentFailure('NOZZLE_NOT_FOUND','External nozzle has no active mapping.');
    const nozzle=this.sqlite.prepare('SELECT * FROM pump_nozzles WHERE id=?').get(nozzleMap.nozzle_id) as any;
    if(!nozzle||nozzle.status!=='Active')throw new PermanentFailure('NOZZLE_NOT_FOUND','Mapped physical nozzle is unavailable or inactive.');
    if(nozzle.physical_pump_id!==pump.id)throw new PermanentFailure('NOZZLE_PUMP_MISMATCH','Mapped nozzle does not belong to the event pump.');
    const product=this.sqlite.prepare('SELECT * FROM fuel_products WHERE id=?').get(nozzle.fuel_product_id) as any;
    if(!product)throw new PermanentFailure('PRODUCT_MISMATCH','Nozzle product is unavailable.');
    const externalProduct=String(payload.externalProductId||'').trim();
    const productMapping=externalProduct?this.sqlite.prepare(`SELECT product_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type='PRODUCT' AND external_equipment_id=? AND status='MAPPED'`).get(event.controllerId,externalProduct) as any:null;
    const eventProduct=normalized(productMapping?.product_id||payload.productCode||payload.productId||externalProduct);
    if(!eventProduct)throw new PermanentFailure('MISSING_REQUIRED_FIELD','Event product identity is required.');
    if(![normalized(product.id),normalized(product.code),normalized(product.name)].includes(eventProduct))throw new PermanentFailure('PRODUCT_MISMATCH','Event product does not match the configured nozzle product.');
    if(controller.adapter_type==='PTS2') {
      const tank=this.sqlite.prepare('SELECT * FROM fuel_tanks WHERE id=?').get(nozzle.tank_id||'') as any;
      if(!tank||tank.fuel_product_id!==product.id||!productMapping||productMapping.product_id!==product.id)throw new PermanentFailure('PTS2_TANK_MAPPING_REQUIRED','Resolve controller fuel grade, nozzle product and explicit supplying tank mapping before posting.');
    }
    const quantity=finite(payload.quantityLiters??payload.liters??payload.quantity);
    if(!Number.isFinite(quantity)||quantity<=0||decimalPlaces(quantity)>3)throw new PermanentFailure('INVALID_QUANTITY','Dispensed quantity must be positive, finite, and use at most three decimal places.');
    const configuredPrice=Number(product.price_per_liter);
    if(!Number.isFinite(configuredPrice)||configuredPrice<=0)throw new PermanentFailure('INVALID_PRICE','Authoritative DEITAX FMS.A product price is unavailable.');
    // A completed PTS-2 report is the immutable evidence of the price actually
    // used by the dispenser. Keep the DEITAX FMS.A product/mapping authoritative for
    // identity, but post the controller's witnessed price instead of rejecting
    // a real sale merely because the two systems' price lists are out of sync.
    const trustedPts2Report=payload.readOnlySource===true&&(event.source==='PTS2_REPORT'||event.eventId.startsWith('pts2-sale:'));
    const suppliedPrice=payload.unitPrice==null?NaN:finite(payload.unitPrice);
    if(payload.unitPrice!=null&&!Number.isFinite(suppliedPrice))throw new PermanentFailure('INVALID_PRICE','Event unit price is invalid.');
    if(!trustedPts2Report&&payload.unitPrice!=null&&Math.abs(suppliedPrice-configuredPrice)>0.005)throw new PermanentFailure('INVALID_PRICE','Event unit price does not match the authoritative DEITAX FMS.A price.');
    const price=trustedPts2Report&&Number.isFinite(suppliedPrice)&&suppliedPrice>0?suppliedPrice:configuredPrice;
    if(!Number.isFinite(price)||price<=0)throw new PermanentFailure('INVALID_PRICE','Dispensing price must be positive and finite.');
    const amount=Number((quantity*price).toFixed(2));
    if(payload.amount!=null){const supplied=finite(payload.amount);if(!Number.isFinite(supplied)||Math.abs(supplied-amount)>0.01)throw new PermanentFailure('INVALID_AMOUNT','Event amount does not match quantity multiplied by authoritative price.');}
    const occurred=new Date(event.sourceOccurredAt),received=new Date(event.receivedAt),now=Date.now();
    if(!Number.isFinite(occurred.getTime())||!Number.isFinite(received.getTime())||occurred.getTime()>now+300000||received.getTime()>now+300000||received.getTime()<occurred.getTime()-300000)throw new PermanentFailure('INVALID_TIMESTAMP','Event timestamps are invalid or outside the permitted clock tolerance.');
    return{controller,pump,nozzle,product,quantity,price,amount,configuredPrice,priceMismatch:Math.abs(price-configuredPrice)>0.005,externalPumpId,externalNozzleId};
  }

  private post(event:AutomationEventEnvelope,inboxId:string,v:any):FuelTransactionProcessingResult{
    const transactionId=`auto-tx-${randomUUID()}`;
    this.sqlite.transaction(()=>{
      const already=this.sqlite.prepare(`SELECT transaction_id FROM automation_fuel_transaction_processing WHERE inbox_id=? AND processing_status='POSTED'`).get(inboxId) as any;
      if(already)return;
      this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET processing_status='POSTING',posting_started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=? AND processing_status='VALIDATED'`).run(inboxId);
      const occurred=new Date(event.sourceOccurredAt);
      const storedTaxRate=Number(v.product.tax_rate||0);
      // Current product records store rates as decimal fractions (0.08 = 8%).
      // Retain compatibility with older percentage-style records (16 = 16%).
      const taxRate=storedTaxRate>1?storedTaxRate/100:storedTaxRate;
      const subtotal=Number((v.amount/(1+taxRate)).toFixed(2));
      const tax=Number((v.amount-subtotal).toFixed(2));
      const item={itemId:v.product.id,pumpId:v.pump.id,nozzleId:v.nozzle.id,name:v.product.name,type:'Fuel',qty:v.quantity,unitPrice:v.price,totalPrice:v.amount,taxAmount:tax,taxCode:v.product.tax_code||'B',source:'AUTOMATION'};
      const shiftWindows=(this.sqlite.prepare('SELECT id,start_time,end_time,opening_pump_readings_json FROM shifts ORDER BY start_time,id').all() as any[]).map(shift=>{try{return{...shift,readings:JSON.parse(shift.opening_pump_readings_json||'[]')};}catch{return{...shift,readings:[]};}});
      const activeShifts=shiftWindows.filter(shift=>Date.parse(shift.start_time)<=occurred.getTime()&&(!shift.end_time||occurred.getTime()<=Date.parse(shift.end_time))&&shift.readings.some((reading:any)=>String(reading.pumpId)===String(v.nozzle.id)));
      const shiftId=activeShifts.length===1?activeShifts[0].id:null;
      const unattended=activeShifts.length===0;
      const nextWindow=unattended?shiftWindows.find(shift=>occurred.getTime()<=Date.parse(shift.start_time)&&shift.readings.some((reading:any)=>String(reading.pumpId)===String(v.nozzle.id)&&(!reading.previousShiftEnd||occurred.getTime()>Date.parse(reading.previousShiftEnd)))):null;
      const pts2 = v.controller.adapter_type === 'PTS2';
      const receiptNumber = pts2 ? nextReceiptNumber(this.sqlite) : null;
      let configuredMethod = 'Unassigned';
      try { configuredMethod = JSON.parse(v.controller.configuration_json || '{}').automatedPaymentMethod || 'Unassigned'; } catch {}
      const method = ['Cash','M-Pesa','Card','Bank Transfer','Unassigned'].includes(configuredMethod) ? configuredMethod : 'Unassigned';
      this.sqlite.prepare(`INSERT INTO transactions(id,date,time,pump_id,nozzle_id,items_json,product_id,quantity,unit_price,subtotal,tax,total_amount,payment_method,source,attendant_id,attendant_name,receipt_number,invoice_number,document_type,status,shift_id,notes,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'AUTOMATION',NULL,'Automation Runtime',?,NULL,?,?, ?,?,?,CURRENT_TIMESTAMP)`).run(transactionId,occurred.toISOString().slice(0,10),occurred.toISOString().slice(11,19),v.pump.id,v.nozzle.id,JSON.stringify([item]),v.product.id,v.quantity,v.price,subtotal,tax,v.amount,pts2?method:'Unassigned',receiptNumber,pts2?'Receipt':'Automation Capture',pts2?'Completed':'Payment Pending',shiftId,`Automation event ${event.eventId}; ${pts2?'completed PTS-2 sale; receipt issued automatically':'payment not captured'}`,new Date().toISOString());
      this.sqlite.prepare('UPDATE transactions SET dispensed_without_shift=?,meter_reconciliation_shift_id=? WHERE id=?').run(unattended?1:0,nextWindow?.id??null,transactionId);
      if (pts2) {
        this.recordPts2CashFlowInflow({id:transactionId,date:occurred.toISOString().slice(0,10),amount:v.amount,paymentMethod:method,receiptNumber});
        const stock=deductPts2TankStock(this.sqlite,{tankId:v.nozzle.tank_id,productId:v.product.id,quantity:v.quantity,transactionId,controllerId:event.controllerId,eventId:event.eventId,stationId:v.controller.station_id,shiftId,occurredAt:event.sourceOccurredAt,receiptNumber,pumpName:v.pump.pump_name,nozzleName:v.nozzle.nozzle_name});
        if(stock?.anomaly)this.sqlite.prepare("INSERT INTO manager_approvals(id,timestamp,shift_id,type,requested_by,reason,amount_or_qty,status) VALUES(?,?,?,'Fuel Discrepancy','Automation Runtime',?,?,'Pending')").run('stock-review-'+transactionId,event.receivedAt,shiftId,'Negative FMS tank balance after completed PTS-2 sale. Tank '+v.nozzle.tank_id+', transaction '+transactionId+', before '+stock.before+' L, sale '+v.quantity+' L, after '+stock.after+' L. Verify opening balance, receipts and mapping.',stock.after.toFixed(3)+' L');
        this.log(event,inboxId,stock?.anomaly?'WARNING':'INFO',stock?.anomaly||'PTS2_TANK_STOCK_DEDUCTED','PTS-2 sale stock movement recorded.',{transactionId,tankId:v.nozzle.tank_id,quantity:v.quantity,...stock});
        for (const category of ['PTS2_TRANSACTION_VALIDATED','PTS2_SALE_POSTED','PTS2_RECEIPT_CREATED',...(unattended?['PTS2_TRANSACTION_UNATTENDED']:[]),...(nextWindow?['PTS2_TRANSACTION_ASSOCIATED_WITH_SHIFT']:[])]) {
          this.log(event,inboxId,'INFO',category,'Completed PTS-2 sale recorded.',{transactionId,receiptNumber,shiftId,associatedShiftId:nextWindow?.id??null});
        }
      }
      const meterBefore=Number((this.sqlite.prepare('SELECT current_meter_reading FROM pump_nozzles WHERE id=?').get(v.nozzle.id) as any)?.current_meter_reading||0);
      // PTS-2 meters are refreshed from the controller after capture. Replayed
      // transaction reports must never increment a physical cumulative reading.
      const hardwareMeter=v.controller.adapter_type==='PTS2';
      const meterAfter=hardwareMeter?meterBefore:Number((meterBefore+v.quantity).toFixed(3));
      if(!hardwareMeter){
        const meterUpdate=this.sqlite.prepare('UPDATE pump_nozzles SET current_meter_reading=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_meter_reading=?').run(meterAfter,v.nozzle.id,meterBefore);
        if(meterUpdate.changes!==1)throw new Error('Nozzle cumulative meter changed concurrently.');
        this.sqlite.prepare(`INSERT INTO nozzle_reading_history(id,nozzle_id,pump_id,tank_id,fuel_product_id,shift_id,transaction_id,previous_reading,quantity_dispensed,current_reading,reading_type,recorded_by,timestamp) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?)`).run(`reading-auto-${randomUUID()}`,v.nozzle.id,v.pump.id,v.nozzle.tank_id,v.product.id,shiftId,transactionId,meterBefore,v.quantity,meterAfter,'Automated Dispense',event.sourceOccurredAt);
      }
      const updated=this.sqlite.prepare(`UPDATE automation_fuel_transaction_processing SET transaction_id=?,processing_status='POSTED',posted_at=CURRENT_TIMESTAMP,failure_code=NULL,failure_class=NULL,failure_detail=NULL,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=? AND processing_status='POSTING'`).run(transactionId,inboxId);
      if(updated.changes!==1)throw new Error('Automation posting state changed concurrently.');
      this.sqlite.prepare(`UPDATE automation_event_inbox SET processing_status='PROCESSED',processed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(inboxId);
      this.log(event,inboxId,'INFO','FUEL_TRANSACTION_POSTED','Automated fuel transaction posted.',{transactionId,pumpId:v.pump.id,nozzleId:v.nozzle.id,productId:v.product.id,quantity:v.quantity,meterBefore,meterAfter,unitPrice:v.price,configuredUnitPrice:v.configuredPrice,priceMismatch:v.priceMismatch,amount:v.amount});
    })();
    const actual=this.sqlite.prepare('SELECT transaction_id FROM automation_fuel_transaction_processing WHERE inbox_id=?').get(inboxId) as any;
    return{outcome:actual?.transaction_id===transactionId?'POSTED':'DUPLICATE',transactionId:actual?.transaction_id};
  }

  private recordPts2CashFlowInflow(sale:{id:string;date:string;amount:number;paymentMethod:string;receiptNumber:string|null}){
    const reference=sale.receiptNumber||sale.id;
    this.sqlite.prepare(`INSERT OR IGNORE INTO cash_flow_records(id,date,type,category,description,amount,accounting_method,reference_no,related_transaction_id,recorded_by,recorded_by_name,notes,status) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?)`).run(
      `cf-pts2-${sale.id}`,
      sale.date,
      'Inflow',
      'Fuel Sales',
      `PTS-2 fuel sale ${reference}`,
      Number(sale.amount),
      sale.paymentMethod||'Unassigned',
      reference,
      sale.id,
      'Automation Runtime',
      `PTS-2 completed sale ${reference}`,
      'Recorded'
    );
  }

  private log(event:AutomationEventEnvelope,inboxId:string,level:string,category:string,message:string,details:unknown){
    this.sqlite.prepare(`INSERT INTO automation_logs(id,controller_id,event_id,timestamp,level,category,message,details_json,correlation_id) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?)`).run(randomUUID(),event.controllerId,inboxId,level,category,message,JSON.stringify(details),event.correlationId||null);
  }
}
