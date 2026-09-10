import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { MappingService } from '../mappings/mapping-service.js';
import type { AdapterManager } from '../adapters/adapter-manager.js';
import type { MappingInput } from '../mappings/mapping-service.js';

const inputSchema=z.object({controllerId:z.string().trim().min(1),stationId:z.string().trim().min(1).optional(),equipmentType:z.enum(['PUMP','NOZZLE','TANK','PRODUCT']),externalEquipmentId:z.string().trim().min(1).max(200),externalParentId:z.string().trim().max(200).optional().default(''),targetId:z.string().trim().min(1)}).strict();
const clean=(body:any)=>{const value={...(body||{})};for(const key of ['actorUserId','actorRole','userRole','userName'])delete value[key];return value;};
const toMappingInput=(data:z.infer<typeof inputSchema>):MappingInput=>({controllerId:data.controllerId!,stationId:data.stationId,equipmentType:data.equipmentType!,externalEquipmentId:data.externalEquipmentId!,externalParentId:data.externalParentId??'',targetId:data.targetId!});
export function createMappingRouter(deps:{sqlite:Database.Database;requirePermission:(req:any,res:any,permission:any,action:string)=>any;addAuditLog:(...args:any[])=>unknown;manager?:AdapterManager}){
  const router=Router();const service=new MappingService(deps.sqlite,deps.addAuditLog);
  const guard=(req:any,res:any,permission:string,action:string)=>Boolean(deps.requirePermission(req,res,permission,action));
  const fail=(res:any,error:unknown)=>res.status(/already|conflict|duplicate/i.test(error instanceof Error?error.message:'')?409:400).json({success:false,message:error instanceof Error?error.message:'Mapping operation failed.'});
  router.get('/',(req:any,res)=>{if(guard(req,res,'VIEW_DEVICE_MAPPINGS','view device mappings'))return;res.json(service.list());});
  router.get('/discovered',(req:any,res)=>{if(guard(req,res,'VIEW_DEVICE_MAPPINGS','view discovered devices'))return;res.json(service.discovered(typeof req.query.controllerId==='string'?req.query.controllerId:undefined));});
  router.get('/equipment',(req:any,res)=>{if(guard(req,res,'VIEW_DEVICE_MAPPINGS','view physical equipment topology'))return;res.json(service.equipment(typeof req.query.stationId==='string'?req.query.stationId:undefined));});
  router.post('/discover/:controllerId',async(req:any,res)=>{if(guard(req,res,'MANAGE_DEVICE_MAPPINGS','run read-only device discovery'))return;try{const controller=deps.sqlite.prepare('SELECT adapter_type FROM automation_controllers WHERE id=?').get(req.params.controllerId) as any;const devices=controller?.adapter_type==='PTS2'?await deps.manager?.discover(req.params.controllerId):undefined;res.json(await service.discover(req.params.controllerId,devices));}catch(e){fail(res,e);}});
  router.post('/validate',(req:any,res)=>{if(guard(req,res,'MANAGE_DEVICE_MAPPINGS','validate a device mapping'))return;const parsed=inputSchema.safeParse(clean(req.body));if(!parsed.success)return res.status(400).json({success:false,message:'Invalid mapping request.',errors:parsed.error.flatten()});try{res.json(service.validate(toMappingInput(parsed.data)));}catch(e){fail(res,e);}});
  router.post('/',(req:any,res)=>{if(guard(req,res,'MANAGE_DEVICE_MAPPINGS','create a device mapping'))return;const parsed=inputSchema.safeParse(clean(req.body));if(!parsed.success)return res.status(400).json({success:false,message:'Invalid mapping request.',errors:parsed.error.flatten()});try{res.status(201).json(service.create(toMappingInput(parsed.data),req.authUser));}catch(e){fail(res,e);}});
  router.get('/:id',(req:any,res)=>{if(guard(req,res,'VIEW_DEVICE_MAPPINGS','view a device mapping'))return;const row=service.get(req.params.id);if(!row)return res.status(404).json({success:false,message:'Mapping not found.'});res.json(row);});
  router.patch('/:id',(req:any,res)=>{if(guard(req,res,'MANAGE_DEVICE_MAPPINGS','change a device mapping'))return;const parsed=inputSchema.safeParse(clean(req.body));if(!parsed.success)return res.status(400).json({success:false,message:'Invalid mapping request.',errors:parsed.error.flatten()});try{res.json(service.update(req.params.id,toMappingInput(parsed.data),req.authUser));}catch(e){fail(res,e);}});
  router.post('/:id/disable',(req:any,res)=>{if(guard(req,res,'MANAGE_DEVICE_MAPPINGS','disable a device mapping'))return;try{res.json(service.setEnabled(req.params.id,false,req.authUser));}catch(e){fail(res,e);}});
  router.post('/:id/restore',(req:any,res)=>{if(guard(req,res,'MANAGE_DEVICE_MAPPINGS','restore a device mapping'))return;try{res.json(service.setEnabled(req.params.id,true,req.authUser));}catch(e){fail(res,e);}});
  router.get('/:id/history',(req:any,res)=>{if(guard(req,res,'VIEW_DEVICE_MAPPINGS','view mapping history'))return;res.json(service.historyFor(req.params.id));});
  return router;
}
