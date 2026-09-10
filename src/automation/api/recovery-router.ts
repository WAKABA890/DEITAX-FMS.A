import{Router,type Request,type Response}from'express';import type{RecoveryCoordinator}from'../recovery/recovery-coordinator.js';
export function createRecoveryRouter(d:{coordinator:RecoveryCoordinator}){const r=Router();r.get('/status',(_q:Request,s:Response)=>s.json(d.coordinator.snapshot()));return r}
