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

/** User observations are evidence only. Continuity uses the last physical closing. */
export function buildOpeningNozzleReadings(pumps:any[],submitted:any[],system:Map<string,number>,previous:Map<string,{shiftId:string;endTime:string;meter:number}>,transactions:any[],at:string){
  const reported=new Map(submitted.map(reading=>[String(reading.pumpId),reading]));
  return pumps.map(pump=>{
    const id=String(pump.id),prior=previous.get(id),authoritativeOpeningMeter=system.get(id);
    if(authoritativeOpeningMeter==null||!Number.isFinite(authoritativeOpeningMeter))throw new Error(`System meter unavailable for ${pump.pumpName||id}.`);
    const openingMeter=prior?.meter??authoritativeOpeningMeter;
    const reportedOpeningMeter=recordedMeter(reported.get(id)?.openingMeter);
    const unattended=prior?transactions.filter(tx=>isMeterSale(tx)&&tx.dispensedWithoutShift&&!tx.meterReconciliationShiftId&&nozzleTransactionLiters(tx,id)>0&&Date.parse(tx.timestamp)>Date.parse(prior.endTime)&&Date.parse(tx.timestamp)<=Date.parse(at)):[];
    const unattendedMeterLiters=meterRound(authoritativeOpeningMeter-openingMeter);
    const unattendedSalesLiters=meterRound(unattended.reduce((sum,tx)=>sum+nozzleTransactionLiters(tx,id),0));
    return{pumpId:id,pumpName:pump.pumpName||'Pump Nozzle',fuelName:pump.fuelName||'Fuel',openingMeter,authoritativeOpeningMeter,reportedOpeningMeter,variance:reportedOpeningMeter==null?undefined:meterRound(reportedOpeningMeter-authoritativeOpeningMeter),previousShiftId:prior?.shiftId,previousShiftEnd:prior?.endTime,unattendedMeterLiters,unattendedSalesLiters,unattendedVarianceLiters:meterRound(unattendedMeterLiters-unattendedSalesLiters),unattendedTransactionIds:unattended.map(tx=>String(tx.id))};
  });
}

/** Physical movement includes the unattended interval; collections never reassign dispensing. */
export function buildClosingNozzleReadings(openings:any[],submitted:any[],system:Map<string,number>,transactions:any[],shiftId:string){
  const reported=new Map(submitted.map(reading=>[String(reading.pumpId),reading]));
  return openings.map(opening=>{
    const nozzleId=String(opening.pumpId),openingMeter=Number(opening.openingMeter),closingMeter=system.get(nozzleId);
    if(!Number.isFinite(openingMeter)||closingMeter==null||!Number.isFinite(closingMeter)||closingMeter<openingMeter)throw new Error(`Invalid system closing meter for ${opening.pumpName||nozzleId}. It must be at least the opening reading.`);
    const reportedClosingMeter=recordedMeter(reported.get(nozzleId)?.closingMeter);
    const sales=transactions.filter(tx=>isMeterSale(tx)&&(tx.shiftId===shiftId||tx.meterReconciliationShiftId===shiftId));
    const unattendedSalesLiters=meterRound(sales.filter(tx=>tx.dispensedWithoutShift&&tx.meterReconciliationShiftId===shiftId).reduce((sum,tx)=>sum+nozzleTransactionLiters(tx,nozzleId),0));
    const posSalesLiters=meterRound(sales.reduce((sum,tx)=>sum+nozzleTransactionLiters(tx,nozzleId),0));
    const meterSalesLiters=meterRound(closingMeter-openingMeter),unattendedMeterLiters=Number(opening.unattendedMeterLiters||0);
    return{pumpId:nozzleId,pumpName:opening.pumpName,fuelName:opening.fuelName,openingMeter,closingMeter,authoritativeClosingMeter:closingMeter,reportedClosingMeter,reportedVarianceLiters:reportedClosingMeter==null?undefined:meterRound(reportedClosingMeter-closingMeter),posSalesLiters,meterSalesLiters,varianceLiters:meterRound(meterSalesLiters-posSalesLiters),unattendedMeterLiters,unattendedSalesLiters,staffedMeterLiters:meterRound(meterSalesLiters-unattendedMeterLiters)};
  });
}
