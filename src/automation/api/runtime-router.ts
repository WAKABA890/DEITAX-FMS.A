import { Router } from 'express';
import type { AdapterManager } from '../adapters/adapter-manager.js';

export function createRuntimeRouter(deps:{manager:AdapterManager;requirePermission:(req:any,res:any,p:any,a:string)=>any;addAuditLog:(...args:any[])=>unknown}){
  const router=Router();
  const guard=(req:any,res:any,permission:string,action:string)=>Boolean(deps.requirePermission(req,res,permission,action));
  const fail=(res:any,error:unknown)=>res.status(400).json({success:false,message:error instanceof Error?error.message:String(error)});
  router.get('/registry',(req:any,res)=>{if(guard(req,res,'VIEW_AUTOMATION','view adapter registry'))return;res.json(deps.manager.registered());});
  router.get('/:id/status',async(req:any,res)=>{if(guard(req,res,'VIEW_AUTOMATION','view adapter status'))return;try{res.json(await deps.manager.status(req.params.id));}catch(error){console.error('[Automation] Runtime status failed safely:',error);res.status(503).json({success:false,code:'AUTOMATION_RUNTIME_UNAVAILABLE',message:'Adapter status is temporarily unavailable.'});}});
  router.post('/:id/connect',async(req:any,res)=>{if(guard(req,res,'MANAGE_CONTROLLERS','connect simulator adapter'))return;try{deps.addAuditLog(req.authUser.id,req.authUser.name,req.authUser.role,'ADAPTER_CONNECT_REQUESTED','Automation',`Adapter connect requested for ${req.params.id}.`);res.json(await deps.manager.start(req.params.id));}catch(error){fail(res,error);}});
  router.post('/:id/disconnect',async(req:any,res)=>{if(guard(req,res,'MANAGE_CONTROLLERS','disconnect simulator adapter'))return;try{deps.addAuditLog(req.authUser.id,req.authUser.name,req.authUser.role,'ADAPTER_DISCONNECT_REQUESTED','Automation',`Adapter disconnect requested for ${req.params.id}.`);res.json(await deps.manager.disconnect(req.params.id));}catch(error){fail(res,error);}});
  router.post('/:id/restart',async(req:any,res)=>{if(guard(req,res,'MANAGE_CONTROLLERS','restart simulator adapter'))return;try{deps.addAuditLog(req.authUser.id,req.authUser.name,req.authUser.role,'ADAPTER_RESTART_REQUESTED','Automation',`Adapter restart requested for ${req.params.id}.`);res.json(await deps.manager.restart(req.params.id));}catch(error){fail(res,error);}});
  router.post('/:id/scenario',async(req:any,res)=>{if(guard(req,res,'MANAGE_CONTROLLERS','generate simulator events'))return;try{res.json(await deps.manager.scenario(req.params.id,String(req.body.scenario||''),req.body.options));}catch(error){fail(res,error);}});
  return router;
}
