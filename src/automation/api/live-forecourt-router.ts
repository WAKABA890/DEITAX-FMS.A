import { Router } from 'express';
import type { AdapterManager } from '../adapters/adapter-manager.js';
import type { LiveForecourtProjection } from '../live/live-forecourt-projection.js';

export function createLiveForecourtRouter(deps:{projection:LiveForecourtProjection;manager:AdapterManager;requirePermission:(req:any,res:any,p:any,a:string)=>any}){
  const router=Router();const guard=(req:any,res:any)=>Boolean(deps.requirePermission(req,res,'VIEW_AUTOMATION','view Live Forecourt'));
  const snapshot=async()=>{const value:any=deps.projection.snapshot();value.controllers=await Promise.all(value.controllers.map(async(controller:any)=>{try{const runtime:any=await deps.manager.status(controller.id);return{...controller,runtimeStatus:runtime.runtimeStatus,health:runtime.health};}catch{return{...controller,runtimeStatus:null,health:null};}}));return value;};
  router.get('/snapshot',async(req:any,res)=>{if(guard(req,res))return;try{res.json(await snapshot());}catch(error){console.error('[Automation] Live Forecourt snapshot failed:',error);res.status(503).json({success:false,code:'AUTOMATION_SNAPSHOT_UNAVAILABLE',message:'Live Forecourt is temporarily unavailable.'});}});
  router.get('/stream',async(req:any,res)=>{if(guard(req,res))return;try{res.status(200);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.();let closed=false;const send=async()=>{if(closed)return;try{res.write(`event: snapshot\ndata: ${JSON.stringify(await snapshot())}\n\n`);}catch(error){console.warn('[Automation] SSE delivery failed safely:',error instanceof Error?error.message:String(error));}};await send();const unsubscribe=deps.projection.onChange(()=>void send());const timer=setInterval(()=>void send(),5000);req.on('close',()=>{closed=true;clearInterval(timer);unsubscribe();});}catch(error){console.error('[Automation] SSE initialization failed:',error);if(!res.headersSent)res.status(503).json({success:false,code:'AUTOMATION_STREAM_UNAVAILABLE',message:'Live Forecourt stream is temporarily unavailable.'});else res.end();}});
  return router;
}
