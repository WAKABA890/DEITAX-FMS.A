import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ManagerApproval } from '../../types.js';
import { hasMeterVariance, meterRound } from '../../utils/shift-meter-readings.js';

export function previousNozzleClosings(db:Database.Database){
  const result=new Map<string,{shiftId:string;endTime:string;meter:number}>();
  const rows=db.prepare("SELECT id,end_time,closing_pump_readings_json FROM shifts WHERE end_time IS NOT NULL AND status<>'Active' ORDER BY end_time DESC,created_at DESC,id DESC").all() as any[];
  for(const row of rows){
    let readings:any[]=[];try{readings=JSON.parse(row.closing_pump_readings_json||'[]');}catch{continue;}
    if(!Array.isArray(readings))continue;
    for(const reading of readings){
      const value=reading.authoritativeClosingMeter??reading.closingMeter,meter=Number(value),id=String(reading.pumpId);
      if(!result.has(id)&&value!=null&&Number.isFinite(meter)&&meter>=0)result.set(id,{shiftId:row.id,endTime:row.end_time,meter});
    }
  }
  return result;
}

/** Persist the comparison and its manager review in the caller's transaction. */
export function recordMeterReview(db:Database.Database,input:{shiftId:string;userId:string;userName:string;nozzle:any;stage:'Opening'|'Closing'|'Unattended';reported:number|undefined;authoritative:number;at:string}):ManagerApproval|null{
  if(input.reported==null)return null;
  const variance=meterRound(input.reported-input.authoritative);if(!hasMeterVariance(variance))return null;
  const varianceId=`variance-${randomUUID()}`;
  db.prepare(`INSERT INTO reading_variances(id,shift_id,reading_type,tank_id,nozzle_id,reported_value,authoritative_value,variance,status,recorded_by,recorded_at) VALUES(?,?,'Nozzle Meter',?,?,?,?,?,'Review Required',?,?)`).run(varianceId,input.shiftId,input.nozzle.tankId,input.nozzle.id,input.reported,input.authoritative,variance,input.userId,input.at);
  const approval:ManagerApproval={id:`app-${randomUUID()}`,timestamp:input.at,shiftId:input.shiftId,type:input.stage==='Unattended'?'Unattended Sales Variance':'Nozzle Reading Variance',reviewScope:'READING',readingVarianceId:varianceId,requestedBy:input.userName,reason:input.stage==='Unattended'?`Nozzle ${input.nozzle.pumpName}: unattended meter movement ${input.reported.toFixed(3)} L versus captured unattended sales ${input.authoritative.toFixed(3)} L; variance ${variance.toFixed(3)} L.`:`${input.stage} observation for nozzle ${input.nozzle.pumpName}: user recorded ${input.reported.toFixed(3)} L; system/PTS-2 meter ${input.authoritative.toFixed(3)} L; variance ${variance.toFixed(3)} L. Observation retained without changing the physical meter.`,amountOrQty:`${variance.toFixed(3)} L`,status:'Pending'};
  db.prepare(`INSERT INTO manager_approvals(id,timestamp,shift_id,type,requested_by,reason,amount_or_qty,status,reading_variance_id,review_scope) VALUES(?,?,?,?,?,?,?,'Pending',?,'READING')`).run(approval.id,approval.timestamp,approval.shiftId,approval.type,approval.requestedBy,approval.reason,approval.amountOrQty,varianceId);
  return approval;
}
