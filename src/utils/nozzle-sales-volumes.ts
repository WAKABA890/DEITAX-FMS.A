import { isMeterSale, meterRound, nozzleTransactionLiters } from './shift-meter-readings.ts';

export function nozzleSalesVolumes(nozzleId: string, shift: any, transactions: any[]) {
  let beforeOpeningLiters=0, duringShiftLiters=0, recordedAmount=0;
  const seen=new Set<string>();
  for (const tx of transactions) {
    if (!shift || !isMeterSale(tx) || (tx.id && seen.has(tx.id))) continue;
    if(tx.id)seen.add(tx.id);
    const before=tx.dispensedWithoutShift && tx.meterReconciliationShiftId===shift.id;
    if(!before && tx.shiftId!==shift.id)continue;
    const qty=nozzleTransactionLiters(tx,nozzleId);
    if(!Number.isFinite(qty)||qty<=0)continue;
    if(before)beforeOpeningLiters+=qty;else duringShiftLiters+=qty;
    const items=(tx.items||[]).filter((i:any)=>String(i.type).toUpperCase()==='FUEL'&&String(i.nozzleId||tx.nozzleId||i.pumpId||'')===nozzleId);
    const amount=items.length?items.reduce((sum:number,i:any)=>sum+Number(i.totalPrice??Number(i.qty)*Number(i.unitPrice)),0):Number(tx.totalAmount||0);
    if(Number.isFinite(amount))recordedAmount+=amount;
  }
  return {beforeOpeningLiters:meterRound(beforeOpeningLiters),duringShiftLiters:meterRound(duringShiftLiters),recordedLiters:meterRound(beforeOpeningLiters+duringShiftLiters),recordedAmount};
}

export function nozzleMeterVolume(opening: unknown, current: unknown, review=false) {
  if(opening==null||current==null||opening===''||current==='')return {liters:null,state:'Unavailable'};
  const a=Number(opening),b=Number(current);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0)return {liters:null,state:'Unavailable'};
  if(review||b<a)return {liters:null,state:'Review required'};
  return {liters:meterRound(b-a),state:'Valid'};
}

/** A display calculation, never a replacement for controller-owned meter evidence. */
export function calculatedNozzleReading(opening:unknown,nozzleId:string,shift:any,transactions:any[],pts2Only=true){
  if(!shift||opening==null||opening===''||!Number.isFinite(Number(opening))||Number(opening)<0)return {currentMeter:null,dispensedLiters:null};
  const start=Date.parse(shift.startTime),end=shift.endTime?Date.parse(shift.endTime):Infinity;
  const sales=transactions.filter(tx=>{
    const at=Date.parse(tx.timestamp);
    return tx.status==='Completed'&&(!pts2Only||tx.source==='AUTOMATION')&&!tx.dispensedWithoutShift
      &&tx.shiftId===shift.id&&Number.isFinite(at)&&at>=start&&at<=end;
  });
  const dispensedLiters=nozzleSalesVolumes(nozzleId,shift,sales).duringShiftLiters;
  return {currentMeter:meterRound(Number(opening)+dispensedLiters),dispensedLiters};
}
