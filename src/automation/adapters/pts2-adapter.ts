import { createHash, randomUUID } from 'node:crypto';
import type { AdapterContext, AdapterHealth, AdapterLifecycleState, ControllerAdapter, MappedNozzleIdentity } from '../types/adapters.js';
import type { AutomationEventEnvelope } from '../types/events.js';
import type { DiscoveredDevice } from '../discovery/simulator-discovery-provider.js';

type Packet={Id?:number;Type?:string;Data?:any;Error?:boolean;Code?:number;Message?:string};
type RequestPacket=string|{Type:string;Data?:any};

/** Read-only jsonPTS adapter. It contains no controller command, price, or configuration writes. */
export class Pts2Adapter implements ControllerAdapter {
  readonly type='PTS2'; readonly version='1.2.0-read-only-totalizers';
  private state:AdapterLifecycleState='CREATED'; private context!:AdapterContext;
  private lastSuccess:string|null=null; private lastAttempt:string|null=null; private latency:number|null=null; private lastError:string|null=null; private failures=0;
  private timers=new Set<ReturnType<typeof setInterval>>(); private salesPolling=false; private totalizerPolling=false; private packetId=0;
  private salesInFlight:Promise<void>|null=null;
  private totalizerQueue:Promise<void>=Promise.resolve();
  private controllerIdentifier:string|null=null; private configurationIdentifier:string|null=null;

  async initialize(context:AdapterContext){this.context=context;this.state='DISCONNECTED';}
  async connect(){this.clear();this.state='CONNECTING';try{const identity=await this.request(['GetUniqueIdentifier','GetControllerType','GetDateTime','GetConfigurationIdentifier']);this.controllerIdentifier=String(identity.find(x=>x.Type==='UniqueIdentifier')?.Data?.Id||'')||null;this.configurationIdentifier=String(identity.find(x=>x.Type==='ConfigurationIdentifier')?.Data?.Id||'')||null;this.state='CONNECTED';await Promise.allSettled([this.syncTransactions(),this.syncTotalizers()]);this.schedule(()=>this.syncTransactions(),'PTS2_SALES_SYNC',Math.max(3000,Number(this.context.configuration.salesPollIntervalMs||5000)));this.schedule(()=>this.syncTotalizers(),'PTS2_TOTALIZER_SYNC',Math.max(5000,Number(this.context.configuration.totalizerPollIntervalMs||15000)));}catch(error){this.state='ERROR';throw error;}}
  async disconnect(){this.clear();this.state='DISCONNECTED';} async disable(){this.clear();this.state='DISABLED';} async shutdown(){this.clear();this.state='DISCONNECTED';} getStatus(){return this.state;}
  async healthCheck():Promise<AdapterHealth>{if(this.state==='CONNECTED')try{await this.request(['GetDateTime']);}catch{this.state='ERROR';}return{status:this.state,healthy:this.state==='CONNECTED',lastSuccessfulCommunication:this.lastSuccess,lastAttemptedCommunication:this.lastAttempt,latencyMs:this.latency,lastError:this.lastError,consecutiveFailures:this.failures};}

  async discoverDevices():Promise<DiscoveredDevice[]>{if(this.state!=='CONNECTED')throw new Error('PTS-2 must be connected before discovery.');const packets=await this.request(['GetPumpsConfiguration','GetFuelGradesConfiguration','GetTanksConfiguration','GetProbesConfiguration']),by=(type:string)=>packets.find(packet=>packet.Type===type)?.Data||{},out:DiscoveredDevice[]=[],probes=new Map((by('ProbesConfiguration').Probes||[]).map((probe:any)=>[Number(probe.Id),probe])),configuredPumps=(by('PumpsConfiguration').Pumps||[]).filter((pump:any)=>+pump.Id>0);for(const grade of by('FuelGradesConfiguration').FuelGrades||[])if(+grade.Id>0)out.push({equipmentType:'PRODUCT',externalEquipmentId:String(grade.Id),externalName:String(grade.Name||`Fuel grade ${grade.Id}`)});for(const pump of configuredPumps)out.push({equipmentType:'PUMP',externalEquipmentId:String(pump.Id),externalName:`PTS-2 Pump ${pump.Id}`,externalAddress:String(pump.Address??pump.Id)});const nozzlePackets=await this.request(configuredPumps.map((pump:any)=>({Type:'GetPumpNozzlesConfiguration',Data:{Pump:Number(pump.Id)}}))),nozzleConfigurations=nozzlePackets.flatMap(packet=>{const data=packet.Data;if(Array.isArray(data?.PumpNozzles))return data.PumpNozzles;if(Array.isArray(data))return data;return data&&(data.PumpId!=null||data.Pump!=null)?[{...data,PumpId:data.PumpId??data.Pump}]:[];});for(const pump of nozzleConfigurations){const pumpId=String(pump.PumpId);for(let index=0;index<Math.max(pump.FuelGradeIds?.length||0,pump.TankIds?.length||0,pump.Nozzles?.length||0);index++){const entry=pump.Nozzles?.[index],grade=+(entry?.FuelGradeId??pump.FuelGradeIds?.[index]??0),number=Number(entry?.Nozzle??entry?.Id??index+1);if(grade>0&&number>0)out.push({equipmentType:'NOZZLE',externalEquipmentId:`${pumpId}.${number}`,externalParentId:pumpId,externalName:`Pump ${pumpId} Nozzle ${number}`,externalAddress:`${pumpId}.${number}`,productExternalId:String(grade)});}}for(const tank of by('TanksConfiguration').Tanks||[])if(+tank.Id>0){const probe:any=probes.get(Number(tank.Id));out.push({equipmentType:'TANK',externalEquipmentId:String(tank.Id),externalName:`PTS-2 Tank ${tank.Id}${probe?' / Probe '+probe.Id:''}`,externalAddress:String(tank.Id),productExternalId:tank.FuelGradeId?String(tank.FuelGradeId):undefined,metadata:{probeId:probe?.Id??null,probePort:probe?.Port??null,probeAddress:probe?.Address??null,heightMm:tank.Height??null,shape:tank.Shape??null,probeConfigured:Boolean(probe)}});}return out;}
  getCapabilities(){return new Set(['DISCOVERY','PUMP_STATUS_READ','NOZZLE_STATUS_READ','EQUIPMENT_HEALTH_READ','TRANSACTIONS','TOTALIZER_READ','TOTALIZERS']);}

  private schedule(work:()=>Promise<void>,category:string,interval:number){const timer=setInterval(()=>void work().catch(error=>this.context.log('WARNING',category,'Read-only PTS-2 poll failed.',{error:error instanceof Error?error.message:String(error)})),interval);timer.unref?.();this.timers.add(timer);}
  private async syncTotalizers(){
    if(this.totalizerPolling||this.state!=='CONNECTED')return;
    this.totalizerPolling=true;
    try{await this.refreshTotalizers();}finally{this.totalizerPolling=false;}
  }
  async refreshTotalizers(externalNozzleIds?:string[]):Promise<void>{
    const work=this.totalizerQueue.then(async()=>{
      if(this.state!=='CONNECTED')throw new Error('PTS2_TOTALIZER_CONTROLLER_DISCONNECTED');
      const mapped=(this.context.getMappedNozzles?.()||[]).filter(nozzle=>!externalNozzleIds||externalNozzleIds.includes(nozzle.externalNozzleId));
      if(externalNozzleIds?.some(id=>!mapped.some(nozzle=>nozzle.externalNozzleId===id)))throw new Error('PTS2_TOTALIZER_NOZZLE_NOT_MAPPED');
      const nozzlesByPump=new Map<string,MappedNozzleIdentity[]>();
      for(const nozzle of mapped){const nozzles=nozzlesByPump.get(nozzle.externalPumpId)||[];nozzles.push(nozzle);nozzlesByPump.set(nozzle.externalPumpId,nozzles);}
      const failures=(await Promise.all([...nozzlesByPump.values()].map(async nozzles=>{
        const pumpFailures:any[]=[];
        for(const nozzle of nozzles){
          try{await this.readTotalizer(nozzle);}
          catch(error){pumpFailures.push({pump:nozzle.externalPumpId,nozzle:nozzle.nozzleNumber,error:error instanceof Error?error.message:String(error)});}
        }
        return pumpFailures;
      }))).flat();
      this.context.log(failures.length?'WARNING':'INFO','PTS2_TOTALIZER_SYNC','Read-only PTS-2 totalizer cycle completed.',{mappedNozzles:mapped.length,failedNozzles:failures.length,failures});
      if(failures.length)throw new Error('PTS2_TOTALIZER_REFRESH_FAILED: '+failures.map(failure=>failure.error).join('; '));
    });
    this.totalizerQueue=work.catch(()=>{});
    return work;
  }
  private async readTotalizer(nozzle:MappedNozzleIdentity,attempt=0){
    const pump=Number(nozzle.externalPumpId);
    let result:Packet|undefined,readMethod='PumpGetLastSavedTotals';
    try{
      const packets=await this.request([{Type:readMethod,Data:{Pump:pump,Nozzle:nozzle.nozzleNumber}}]);
      result=packets.find(packet=>packet.Type==='PumpLastSavedTotals'&&Number(packet.Data?.Pump)===pump);
    }catch(error){
      if(!(error instanceof Error)||!error.message.includes('JSONPTS_ERROR_AUTOREAD_PUMPS_TOTALS_NOT_CONFIGURED'))throw error;
      this.context.log('WARNING','PTS2_SAVED_TOTALS_UNAVAILABLE','Automatic saved totals are not configured; requesting live nozzle totals.',{pump,nozzle:nozzle.nozzleNumber});
      readMethod='PumpGetTotals';
      const accepted=await this.request([{Type:readMethod,Data:{Pump:pump,Nozzle:nozzle.nozzleNumber}}]);
      if(!accepted.some(packet=>packet.Type==='PumpGetTotals'&&packet.Message==='OK'))throw new Error('PTS2_LIVE_TOTALIZER_REQUEST_NOT_CONFIRMED');
      const deadline=Date.now()+Math.max(1000,Number(this.context.configuration.totalizerResponseTimeoutMs||10000));
      while(Date.now()<deadline){
        if(this.state!=='CONNECTED')throw new Error('PTS2_TOTALIZER_CONTROLLER_DISCONNECTED');
        await new Promise(resolve=>setTimeout(resolve,Math.max(100,Number(this.context.configuration.totalizerStatusPollMs||250))));
        const packets=await this.request([{Type:'PumpGetStatus',Data:{Pump:pump}}]);
        result=packets.find(packet=>packet.Type==='PumpTotals'&&this.nozzleTotalsData(packet,pump,nozzle.nozzleNumber));
        if(result)break;
      }
      if(!result){if(attempt<1){this.context.log('WARNING','PTS2_TOTALIZER_TIMEOUT','Live totalizer completion timed out; retrying the complete R138 operation once.',{controller:this.context.controllerId,pump,nozzle:nozzle.nozzleNumber,request:'PumpGetTotals',statusPoll:'PumpGetStatus',timeoutMs:Math.max(1000,Number(this.context.configuration.totalizerResponseTimeoutMs||10000))});return this.readTotalizer(nozzle,attempt+1);}throw new Error("PTS2_LIVE_TOTALIZER_TIMEOUT_PUMP_"+pump+"_NOZZLE_"+nozzle.nozzleNumber);}
    }
    const data=this.nozzleTotalsData(result,pump,nozzle.nozzleNumber);
    if(!result||!data)throw new Error(`PTS2_TOTALIZER_RESPONSE_MISSING_PUMP_${pump}_NOZZLE_${nozzle.nozzleNumber}`);
    const volume=Number(data.Volume);
    if(data.Volume==null||data.Volume===''||!Number.isFinite(volume)||volume<0)throw new Error('PTS2_INVALID_TOTALIZER_READING');const receivedAt=new Date().toISOString(),transaction=data?.Transaction==null?null:String(data.Transaction),identity=[this.context.controllerId,nozzle.externalPumpId,nozzle.externalNozzleId,volume.toFixed(3),String(data?.Amount??''),transaction??'',randomUUID()].join(':'),eventId=`pts2-totalizer:${createHash('sha256').update(identity).digest('hex')}`,payload={externalPumpId:nozzle.externalPumpId,externalNozzleId:nozzle.externalNozzleId,totalizerValue:Number(volume.toFixed(3)),unit:'L' as const,amountTotalizer:data?.Amount==null?null:Number(data.Amount),transactionNumber:data?.Transaction??null,controllerIdentifier:this.controllerIdentifier,configurationIdentifier:this.configurationIdentifier,sourceRequestId:result.Id,sourcePacketId:result.Id,meterReadMethod:readMethod,sequenceUnavailable:true,readOnlySource:true};const event:AutomationEventEnvelope={eventId,eventType:'TOTALIZER_READING_RECEIVED',controllerId:this.context.controllerId,externalDeviceId:nozzle.externalNozzleId,deviceType:'NOZZLE',sourceSequence:null,sourceOccurredAt:receivedAt,receivedAt,schemaVersion:1,payload,rawPayloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),source:'PTS2_PUMP_TOTALS'};await this.context.emit(event);
  }
  private nozzleTotalsData(packet:Packet|undefined,pump:number,nozzle:number){const data=packet?.Data;if(Number(data?.Pump)!==pump)return undefined;return Array.isArray(data?.Nozzles)?data.Nozzles.find((entry:any)=>Number(entry?.Nozzle)===nozzle):Number(data?.Nozzle)===nozzle?data:undefined;}

  async refreshTransactions(){await this.syncTransactions();}
  private syncTransactions():Promise<void>{
    if(this.salesInFlight)return this.salesInFlight;
    this.salesInFlight=this.readTransactions().finally(()=>{this.salesInFlight=null;});
    return this.salesInFlight;
  }
  private async readTransactions(){if(this.state!=='CONNECTED')throw new Error('PTS2_CONTROLLER_DISCONNECTED');this.salesPolling=true;try{const now=new Date(),cursor=this.context.getCursor?.('PTS2_PUMP_TRANSACTIONS'),start=cursor&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(cursor)?new Date(Date.parse(cursor)-300000):new Date(now.getTime()-86400000),packets=await this.request([{Type:'ReportGetPumpTransactions',Data:{Pump:0,DateTimeStart:this.local(start),DateTimeEnd:this.local(new Date(now.getTime()+60000))}}]),records=packets.find(packet=>packet.Type==='ReportPumpTransactions')?.Data;if(!Array.isArray(records))throw new Error('PTS2_INVALID_TRANSACTION_REPORT');let latest=start.toISOString();for(const sale of records){const ended=this.iso(sale.DateTime);if(!ended||+sale.Volume<=0)continue;const pump=String(sale.Pump),externalNozzleId=`${pump}.${sale.Nozzle}`,eventId=`pts2-sale:${pump}:${sale.Transaction}:${ended}`,payload={externalPumpId:pump,externalNozzleId,externalProductId:String(sale.FuelGradeId||''),productCode:sale.FuelGradeName||undefined,quantityLiters:+sale.Volume,unitPrice:sale.Price==null?undefined:+sale.Price,amount:sale.Amount==null?undefined:+sale.Amount,totalizerValue:sale.TotalVolume==null?undefined:+sale.TotalVolume,transactionNumber:sale.Transaction,isTest:Boolean(sale.IsTest),readOnlySource:true};const event:AutomationEventEnvelope={eventId,eventType:'DISPENSING_COMPLETED',controllerId:this.context.controllerId,externalDeviceId:externalNozzleId,deviceType:'NOZZLE',sourceSequence:String(sale.Transaction??eventId),sourceOccurredAt:ended,receivedAt:new Date().toISOString(),schemaVersion:1,payload,rawPayloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),source:'PTS2_REPORT'};await this.context.emit(event);if(Date.parse(ended)>Date.parse(latest))latest=ended;}this.context.setCursor?.('PTS2_PUMP_TRANSACTIONS',this.local(now),latest);this.context.log(records.length?'INFO':'DEBUG','PTS2_SALES_SYNC','Read-only PTS-2 transaction poll completed.',{received:records.length,windowStart:this.local(start),windowEnd:this.local(new Date(now.getTime()+60000))});}finally{this.salesPolling=false;}}
  private local(date:Date){const pad=(n:number)=>String(n).padStart(2,'0');return`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;} private iso(value:any){const text=String(value||'');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text))return null;const date=new Date(text);return Number.isFinite(date.getTime())?date.toISOString():null;}
  private endpoint(){const configuration=this.context.configuration,protocol=String(configuration.connectionType||'HTTP').toUpperCase()==='HTTPS'?'https':'http',host=String(configuration.host||''),port=+String(configuration.port||0);if(!host||!port)throw new Error('PTS-2 host and port are required.');return`${protocol}://${host}:${port}/jsonPTS`;}
  private nextPacketId(){this.packetId=this.packetId>=2147483647?1:this.packetId+1;return this.packetId;}
  private async request(requests:RequestPacket[]):Promise<Packet[]>{const configuration=this.context.configuration,credential=configuration.__credential as any;if(!credential?.username||!credential?.password)throw new Error('PTS2_CREDENTIALS_REQUIRED');this.lastAttempt=new Date().toISOString();const started=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(configuration.timeoutMs||10000));try{const response=await fetch(this.endpoint(),{method:'POST',signal:controller.signal,headers:{Accept:'*/*','Content-Type':'application/json; charset=utf-8',Authorization:`Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`},body:JSON.stringify({Protocol:'jsonPTS',Packets:requests.map(request=>typeof request==='string'?{Id:this.nextPacketId(),Type:request}:{Id:this.nextPacketId(),...request})})});if(response.status===401||response.status===403)throw new Error('PTS2_AUTHENTICATION_FAILED');if(!response.ok)throw new Error(`PTS2_HTTP_${response.status}`);const text=await response.text();let body:any;try{body=JSON.parse(text);}catch{throw new Error('PTS2_INVALID_RESPONSE: Expected a jsonPTS response. Verify the controller host, port, protocol, and /jsonPTS endpoint.');}if(body?.Protocol!=='jsonPTS'||!Array.isArray(body.Packets))throw new Error('PTS2_INVALID_RESPONSE');const failed=body.Packets.find((packet:Packet)=>packet.Error);if(failed)throw new Error(`PTS2_${failed.Message||failed.Code||'REQUEST_FAILED'}`);this.latency=Math.max(1,Math.round(performance.now()-started));this.lastSuccess=new Date().toISOString();this.lastError=null;this.failures=0;return body.Packets;}catch(error){this.lastError=error instanceof Error?(error.name==='AbortError'?'PTS2_CONNECTION_TIMEOUT':error.message):String(error);this.failures++;throw new Error(this.lastError);}finally{clearTimeout(timer);}}
  private clear(){for(const timer of this.timers)clearInterval(timer);this.timers.clear();}
}
