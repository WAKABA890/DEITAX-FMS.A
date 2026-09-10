import type { AutomationCapability } from '../automation/types/capabilities';
import type { ControllerState } from '../automation/types/states';

export type ControllerType = 'SIMULATOR' | 'GENERIC' | 'PTS2' | 'WAYNE' | 'OTHER';
export type ControllerConnectionType = 'SIMULATOR' | 'TCP' | 'HTTP' | 'HTTPS';

export interface AutomationControllerDto {
  id: string;
  stationId: string;
  stationName: string;
  name: string;
  controllerType: ControllerType;
  host: string | null;
  port: number | null;
  connectionType: ControllerConnectionType;
  timeoutMs: number;
  configuration: Record<string, unknown>;
  status: ControllerState;
  enabled: boolean;
  lastCommunicationAt: string | null;
  lastSuccessfulConnectionAt: string | null;
  lastError: string | null;
  capabilities: AutomationCapability[];
  firmwareVersion: string | null;
  authenticationConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ControllerInput {
  stationId: string;
  name: string;
  controllerType: ControllerType;
  host: string | null;
  port: number | null;
  connectionType: ControllerConnectionType;
  timeoutMs: number;
  configuration: Record<string, unknown>;
  capabilities: AutomationCapability[];
  firmwareVersion: string | null;
  credential?: { username: string; password: string; authenticationType: 'BASIC' };
}

export interface AutomationLogDto {
  id: string;
  controllerId: string;
  timestamp: string;
  level: string;
  category: string;
  message: string;
  details: Record<string, unknown>;
  correlationId?: string | null;
}

async function automationFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/automation/controllers${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `Controller request failed (${response.status}).`);
  return body as T;
}

export const automationApi = {
  listControllers: () => automationFetch<AutomationControllerDto[]>(''),
  getController: (id: string) => automationFetch<AutomationControllerDto>(`/${id}`),
  createController: (input: ControllerInput) => automationFetch<AutomationControllerDto>('', { method: 'POST', body: JSON.stringify(input) }),
  updateController: (id: string, input: Partial<ControllerInput>) => automationFetch<AutomationControllerDto>(`/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  enableController: (id: string) => automationFetch<AutomationControllerDto>(`/${id}/enable`, { method: 'POST' }),
  disableController: (id: string) => automationFetch<AutomationControllerDto>(`/${id}/disable`, { method: 'POST' }),
  testController: (id: string) => automationFetch<{ success: boolean; timestamp: string; responseTimeMs: number; message: string }>(`/${id}/test`, { method: 'POST' }),
  getControllerLogs: (id: string) => automationFetch<AutomationLogDto[]>(`/${id}/logs`),
};

export type DeviceType = 'PUMP' | 'NOZZLE' | 'TANK' | 'PRODUCT';
export interface DeviceMappingInput { controllerId: string; stationId?: string; equipmentType: DeviceType; externalEquipmentId: string; externalParentId?: string; targetId: string; }
const mappingRequest = async <T>(path = '', options?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/automation/device-mappings${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Device mapping request failed.');
  return data;
};
export const deviceMappingApi = {
  list: () => mappingRequest<any[]>(),
  discovered: (controllerId?: string) => mappingRequest<any[]>(`/discovered${controllerId ? `?controllerId=${encodeURIComponent(controllerId)}` : ''}`),
  equipment: (stationId?: string) => mappingRequest<any>(`/equipment${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ''}`),
  discover: (controllerId: string) => mappingRequest<any[]>(`/discover/${encodeURIComponent(controllerId)}`, { method: 'POST' }),
  create: (input: DeviceMappingInput) => mappingRequest<any>('', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: DeviceMappingInput) => mappingRequest<any>(`/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  disable: (id: string) => mappingRequest<any>(`/${id}/disable`, { method: 'POST' }),
  restore: (id: string) => mappingRequest<any>(`/${id}/restore`, { method: 'POST' }),
  history: (id: string) => mappingRequest<any[]>(`/${id}/history`),
};
const runtimeRequest=async<T>(path:string,options?:RequestInit)=>{const response=await fetch(`/api/automation/runtime${path}`,{credentials:'include',headers:{'Content-Type':'application/json'},...options});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Adapter runtime request failed.');return body as T;};
export const adapterRuntimeApi={status:(id:string)=>runtimeRequest<any>(`/${id}/status`),connect:(id:string)=>runtimeRequest<any>(`/${id}/connect`,{method:'POST'}),disconnect:(id:string)=>runtimeRequest<any>(`/${id}/disconnect`,{method:'POST'}),restart:(id:string)=>runtimeRequest<any>(`/${id}/restart`,{method:'POST'}),scenario:(id:string,scenario:string)=>runtimeRequest<any[]>(`/${id}/scenario`,{method:'POST',body:JSON.stringify({scenario})})};

export interface LiveForecourtNozzle { id:string;nozzle_number:number;nozzle_name?:string;fuel_name:string;product_name?:string;product_code?:string;mappingState:string;controllerName:string|null;externalDeviceId:string|null;operationalState:string;connectionState:string;dataFreshness:string;lastUpdate:string|null;activity:Record<string,unknown>; }
export interface LiveForecourtPump { id:string;pump_number:number;pump_name:string;status:string;mappingState:string;controllerName:string|null;externalDeviceId:string|null;operationalState:string;connectionState:string;dataFreshness:string;lastUpdate:string|null;activity:Record<string,unknown>;nozzles:LiveForecourtNozzle[]; }
export interface LiveForecourtController { id:string;name:string;status:string;connectionState:string;last_communication_at:string|null;last_error:string|null;runtimeStatus:string|null;health:{latencyMs:number|null;lastSuccessfulCommunication:string|null;consecutiveFailures:number;healthy:boolean}|null; }
export interface LiveForecourtSnapshot { generatedAt:string;freshnessThresholdSeconds:number;controllers:LiveForecourtController[];pumps:LiveForecourtPump[];unmappedDevices:any[]; }
export const liveForecourtApi={snapshot:async()=>{const response=await fetch('/api/automation/live-forecourt/snapshot',{credentials:'include'});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Live Forecourt is unavailable.');return body as LiveForecourtSnapshot;},streamUrl:'/api/automation/live-forecourt/stream'};

const meterRequest=async<T>(path:string)=>{const response=await fetch(`/api/automation/meters${path}`,{credentials:'include'});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Meter evidence is unavailable.');return body as T;};
export const meterApi={current:()=>meterRequest<any>('/current'),history:(query='')=>meterRequest<any>(`/history${query?`?${query}`:''}`)};
const atgRequest=async<T>(path:string)=>{const response=await fetch(`/api/automation/atg${path}`,{credentials:'include'});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'ATG tank monitoring is unavailable.');return body as T;};
export const atgApi={current:()=>atgRequest<any>('/current'),attention:()=>atgRequest<any[]>('/attention'),history:(query='')=>atgRequest<any>(`/history${query?`?${query}`:''}`),tankHistory:(tankId:string,query='')=>atgRequest<any>(`/tanks/${encodeURIComponent(tankId)}/history${query?`?${query}`:''}`),controller:(id:string)=>atgRequest<any>(`/controllers/${encodeURIComponent(id)}`)};
const reconciliationRequest=async<T>(path='',options?:RequestInit)=>{const response=await fetch(`/api/automation/reconciliation${path}`,{credentials:'include',headers:{'Content-Type':'application/json'},...options});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Reconciliation is unavailable.');return body as T;};
export const reconciliationApi={list:(query='')=>reconciliationRequest<any>(`${query?`?${query}`:''}`),get:(id:string)=>reconciliationRequest<any>(`/${encodeURIComponent(id)}`),run:(input:any)=>reconciliationRequest<any>('/run',{method:'POST',body:JSON.stringify(input)}),retry:(id:string)=>reconciliationRequest<any>(`/${encodeURIComponent(id)}/retry`,{method:'POST'}),settings:()=>reconciliationRequest<any>('/settings'),saveSettings:(input:any)=>reconciliationRequest<any>('/settings',{method:'PUT',body:JSON.stringify(input)})};
const alertRequest=async<T>(path='',options?:RequestInit)=>{const r=await fetch(`/api/automation/alerts${path}`,{credentials:'include',headers:{'Content-Type':'application/json'},...options}),b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.message||'Alerts unavailable.');return b as T;};export const alertApi={list:(q='')=>alertRequest<any>(q?`?${q}`:''),summary:()=>alertRequest<any>('/summary'),scan:()=>alertRequest<any>('/scan',{method:'POST'}),get:(id:string)=>alertRequest<any>(`/${id}`),ack:(id:string)=>alertRequest<any>(`/${id}/acknowledge`,{method:'POST'}),resolve:(id:string,note:string)=>alertRequest<any>(`/${id}/resolve`,{method:'POST',body:JSON.stringify({note})}),dismiss:(id:string,note:string)=>alertRequest<any>(`/${id}/dismiss`,{method:'POST',body:JSON.stringify({note})})};

const pts2PriceRequest=async<T>(path:string,body:unknown)=>{const response=await fetch(`/api/automation/pts2-prices${path}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.message||'PTS-2 price synchronization failed.') as Error&{code?:string};error.code=data.code;throw error;}return data as T;};
export interface Pts2PricePreview {confirmationToken:string;expiresAt:string;productId:string;productName:string;controllerId:string;controllerName:string;fuelGradeId:number;currentPts2Price:number;intendedPrice:number;preservedFuelGrades:number;}
export const pts2PriceApi={preview:(productId:string,newPrice:number)=>pts2PriceRequest<Pts2PricePreview>('/preview',{productId,newPrice}),confirm:(confirmationToken:string)=>pts2PriceRequest<any>('/confirm',{confirmationToken,confirmed:true})};
