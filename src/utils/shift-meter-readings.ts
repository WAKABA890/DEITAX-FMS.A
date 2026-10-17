export const meterRound=(value:number)=>Number(value.toFixed(3));
export const hasMeterVariance=(value:number|null|undefined)=>value!=null&&Math.abs(meterRound(value))>=0.001;
export function recordedMeter(value:unknown):number|undefined{
  if(value==null||value==='')return undefined;
  const reading=Number(value);
  if(!Number.isFinite(reading)||reading<0)throw new Error('Recorded nozzle readings must be finite, non-negative numbers.');
  return meterRound(reading);
}
export function nozzleTransactionLiters(tx:any,nozzleId:string):number{
  const items=(tx.items||[]).filter((item:any)=>String(item.type).toUpperCase()==='FUEL'&&String(item.nozzleId||tx.nozzleId||item.pumpId||'')===nozzleId);
  return items.length?items.reduce((sum:number,item:any)=>sum+Number(item.qty??item.quantity??0),0):String(tx.nozzleId||'')===nozzleId?Number(tx.quantity||0):0;
}
export const isMeterSale=(tx:any)=>tx.status!=='Voided'&&(tx.status==='Completed'||tx.source==='AUTOMATION');

/** User observations are evidence only. Opening uses the controller snapshot; the prior closing is separate gap evidence. */
export function buildOpeningNozzleReadings(pumps:any[],submitted:any[],system:Map<string,number>,previous:Map<string,{shiftId:string;endTime:string;meter:number}>,transactions:any[],at:string){
  const reported=new Map(submitted.map(reading=>[String(reading.pumpId),reading]));
  return pumps.map(pump=>{
    const id=String(pump.id),prior=previous.get(id),authoritativeOpeningMeter=system.get(id);
    if(authoritativeOpeningMeter==null||!Number.isFinite(authoritativeOpeningMeter))throw new Error(`System meter unavailable for ${pump.pumpName||id}.`);
    const openingMeter=authoritativeOpeningMeter;
    const reportedOpeningMeter=recordedMeter(reported.get(id)?.openingMeter);
    const unattended=transactions.filter(tx=>isMeterSale(tx)&&tx.dispensedWithoutShift&&!tx.meterReconciliationShiftId&&nozzleTransactionLiters(tx,id)>0&&(!prior||Date.parse(tx.timestamp)>Date.parse(prior.endTime))&&Date.parse(tx.timestamp)<=Date.parse(at));
    const unattendedMeterLiters=prior?meterRound(authoritativeOpeningMeter-prior.meter):0;
    const unattendedSalesLiters=meterRound(unattended.reduce((sum,tx)=>sum+nozzleTransactionLiters(tx,id),0));
    return{meterBaselineVersion:2,previousClosingMeter:prior?.meter,pumpId:id,pumpNumber:pump.pumpNumber,nozzleNumber:pump.nozzleNumber,nozzleName:pump.nozzleName,pumpName:pump.pumpName||'Pump Nozzle',fuelName:pump.fuelName||'Fuel',openingMeter,authoritativeOpeningMeter,reportedOpeningMeter,variance:reportedOpeningMeter==null?undefined:meterRound(reportedOpeningMeter-authoritativeOpeningMeter),previousShiftId:prior?.shiftId,previousShiftEnd:prior?.endTime,unattendedMeterLiters,unattendedSalesLiters,unattendedVarianceLiters:prior?meterRound(unattendedMeterLiters-unattendedSalesLiters):null,unattendedTransactionIds:unattended.map(tx=>String(tx.id))};
  });
}

/** Compare during-shift physical movement with during-shift sales; retain gap sales separately. */
export function buildClosingNozzleReadings(openings:any[],submitted:any[],system:Map<string,number>,transactions:any[],shiftId:string,allowReview=false){
  const reported=new Map(submitted.map(reading=>[String(reading.pumpId),reading]));
  return openings.map(opening=>{
    const nozzleId=String(opening.pumpId),openingMeter=Number(opening.openingMeter),closingMeter=system.get(nozzleId);
    const meterIssue=!Number.isFinite(openingMeter)||closingMeter==null||!Number.isFinite(closingMeter)?'METER_UNAVAILABLE':closingMeter<openingMeter?'METER_RESET_OR_DECREASE':null;
    if(meterIssue&&!allowReview)throw new Error(`Invalid system closing meter for ${opening.pumpName||nozzleId}. It must be at least the opening reading.`);
    const reportedClosingMeter=recordedMeter(reported.get(nozzleId)?.closingMeter);
    const sales=transactions.filter(tx=>isMeterSale(tx)&&(tx.shiftId===shiftId||tx.meterReconciliationShiftId===shiftId));
    const unattendedSalesLiters=meterRound(sales.filter(tx=>tx.dispensedWithoutShift&&tx.meterReconciliationShiftId===shiftId).reduce((sum,tx)=>sum+nozzleTransactionLiters(tx,nozzleId),0));
    const totalAssociatedSalesLiters=meterRound(sales.reduce((sum,tx)=>sum+nozzleTransactionLiters(tx,nozzleId),0));
    const posSalesLiters=meterRound(totalAssociatedSalesLiters-unattendedSalesLiters);
    const rawMeterDelta=closingMeter==null?null:meterRound(closingMeter-openingMeter);
    const meterSalesLiters=meterIssue?null:rawMeterDelta,unattendedMeterLiters=Number(opening.unattendedMeterLiters||0);
    return{meterIssue,rawMeterDelta,pumpId:nozzleId,pumpNumber:opening.pumpNumber,nozzleNumber:opening.nozzleNumber,nozzleName:opening.nozzleName,pumpName:opening.pumpName,fuelName:opening.fuelName,openingMeter,closingMeter:closingMeter??null,authoritativeClosingMeter:closingMeter??null,reportedClosingMeter,reportedVarianceLiters:reportedClosingMeter==null||closingMeter==null?undefined:meterRound(reportedClosingMeter-closingMeter),posSalesLiters,totalAssociatedSalesLiters,meterSalesLiters,varianceLiters:meterSalesLiters==null?null:meterRound(meterSalesLiters-posSalesLiters),unattendedMeterLiters,unattendedSalesLiters,staffedMeterLiters:meterSalesLiters};
  });
}
