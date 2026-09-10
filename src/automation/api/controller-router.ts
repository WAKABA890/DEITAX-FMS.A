import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { AUTOMATION_CAPABILITIES } from '../types/capabilities.js';
import { ControllerRepository, type ControllerWriteInput } from '../controllers/controller-repository.js';
import { ControllerService } from '../controllers/controller-service.js';
import {CredentialVault} from '../security/credential-vault.js';
import type {AdapterManager} from '../adapters/adapter-manager.js';

const hostPattern = /^(?=.{1,253}$)(?:\d{1,3}(?:\.\d{1,3}){3}|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/;
const forbiddenConfigurationKey = /password|secret|token|api.?key|credential|authorization|private.?key/i;

const containsForbiddenKey = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value as Record<string, unknown>)
    .some(([key, nested]) => forbiddenConfigurationKey.test(key) || containsForbiddenKey(nested));
};

const controllerInputSchema = z.object({
  stationId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(2).max(100),
  controllerType: z.enum(['SIMULATOR', 'GENERIC', 'PTS2', 'WAYNE', 'OTHER']),
  host: z.string().trim().max(253).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  connectionType: z.enum(['SIMULATOR', 'TCP', 'HTTP', 'HTTPS']),
  timeoutMs: z.number().int().min(100).max(60000),
  configuration: z.record(z.unknown()).default({}),
  capabilities: z.array(z.enum(AUTOMATION_CAPABILITIES)).max(AUTOMATION_CAPABILITIES.length).default([]),
  firmwareVersion: z.string().trim().max(100).nullable().optional(),
  credential: z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(500),authenticationType:z.literal('BASIC')}).optional(),
}).strict().superRefine((value, context) => {
  const simulator = value.controllerType === 'SIMULATOR' && value.connectionType === 'SIMULATOR';
  if ((value.controllerType === 'SIMULATOR') !== (value.connectionType === 'SIMULATOR')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'SIMULATOR type must use the SIMULATOR connection type.' });
  }
  if (!simulator) {
    if (!value.host || !hostPattern.test(value.host)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['host'], message: 'A valid host name or IP address is required.' });
    if (value.port == null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['port'], message: 'A valid port is required.' });
  } else if (value.host || value.port != null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Simulator controllers must not define a network host or port.' });
  }
  if (containsForbiddenKey(value.configuration)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['configuration'], message: 'Secrets are not accepted in controller configuration.' });
  }
  const mode = value.configuration.simulatorMode;
  if (simulator && mode !== undefined && mode !== 'SUCCESS' && mode !== 'FAILURE') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['configuration', 'simulatorMode'], message: 'Simulator mode must be SUCCESS or FAILURE.' });
  }
});

interface RouterDependencies {
  sqlite: Database.Database;
  requirePermission: (req: any, res: any, permission: any, action: string) => any;
  addAuditLog: (...args: any[]) => unknown;
  manager: AdapterManager;
}

const errorResponse = (res: any, error: unknown) => {
  const message = error instanceof Error ? error.message : 'Controller operation failed.';
  const duplicate = /UNIQUE constraint failed/i.test(message);
  return res.status(duplicate ? 409 : 400).json({ success: false, message: duplicate ? 'A controller with that station/name configuration already exists.' : message });
};

const withoutInjectedActorFields = (body: Record<string, unknown> = {}) => {
  const sanitized = { ...body };
  for (const key of ['actorUserId', 'actorRole', 'userRole', 'userName']) delete sanitized[key];
  return sanitized;
};

export function createControllerRouter(dependencies: RouterDependencies) {
  const router = Router();
  const repository = new ControllerRepository(dependencies.sqlite);
  const service = new ControllerService(repository, dependencies.addAuditLog as any);
  const vault = new CredentialVault(dependencies.sqlite);

  router.get('/', (req: any, res) => {
    if (dependencies.requirePermission(req, res, 'VIEW_AUTOMATION', 'view automation controllers')) return;
    res.json(service.list());
  });

  router.get('/:id', (req: any, res) => {
    if (dependencies.requirePermission(req, res, 'VIEW_AUTOMATION', 'view an automation controller')) return;
    const controller = service.get(req.params.id);
    if (!controller) return res.status(404).json({ success: false, message: 'Controller not found.' });
    res.json(controller);
  });

  router.post('/', (req: any, res) => {
    if (dependencies.requirePermission(req, res, 'MANAGE_CONTROLLERS', 'create an automation controller')) return;
    const parsed = controllerInputSchema.safeParse(withoutInjectedActorFields(req.body));
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid controller configuration.', errors: parsed.error.flatten() });
    try {
      const controller=service.create(parsed.data as ControllerWriteInput, req.authUser);if(parsed.data.credential)vault.set(controller.id,parsed.data.credential as any);return res.status(201).json(service.get(controller.id));
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.patch('/:id', (req: any, res) => {
    if (dependencies.requirePermission(req, res, 'MANAGE_CONTROLLERS', 'update an automation controller')) return;
    const current = service.get(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: 'Controller not found.' });
    const requestBody = withoutInjectedActorFields(req.body);
    const parsed = controllerInputSchema.safeParse({
      stationId: requestBody.stationId ?? current.stationId,
      name: requestBody.name ?? current.name,
      controllerType: requestBody.controllerType ?? current.controllerType,
      host: requestBody.host !== undefined ? requestBody.host : current.host,
      port: requestBody.port !== undefined ? requestBody.port : current.port,
      connectionType: requestBody.connectionType ?? current.connectionType,
      timeoutMs: requestBody.timeoutMs ?? current.timeoutMs,
      configuration: requestBody.configuration ?? current.configuration,
      capabilities: requestBody.capabilities ?? current.capabilities,
      firmwareVersion: requestBody.firmwareVersion !== undefined ? requestBody.firmwareVersion : current.firmwareVersion,
      ...Object.fromEntries(Object.keys(requestBody).filter((key) => !['stationId', 'name', 'controllerType', 'host', 'port', 'connectionType', 'timeoutMs', 'configuration', 'capabilities', 'firmwareVersion'].includes(key)).map((key) => [key, requestBody[key]])),
    });
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid controller configuration.', errors: parsed.error.flatten() });
    try {
      const controller=service.update(req.params.id, parsed.data as ControllerWriteInput, req.authUser);if(parsed.data.credential)vault.set(req.params.id,parsed.data.credential as any);return res.json(service.get(req.params.id)||controller);
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post('/:id/enable', (req: any, res) => {
    if (dependencies.requirePermission(req, res, 'MANAGE_CONTROLLERS', 'enable an automation controller')) return;
    const controller = service.setEnabled(req.params.id, true, req.authUser);
    if (!controller) return res.status(404).json({ success: false, message: 'Controller not found.' });
    res.json(controller);
  });

  router.post('/:id/disable', (req: any, res) => {
    if (dependencies.requirePermission(req, res, 'MANAGE_CONTROLLERS', 'disable an automation controller')) return;
    const controller = service.setEnabled(req.params.id, false, req.authUser);
    if (!controller) return res.status(404).json({ success: false, message: 'Controller not found.' });
    res.json(controller);
  });

  router.post('/:id/test', async (req: any, res) => {
    if (dependencies.requirePermission(req, res, 'MANAGE_CONTROLLERS', 'test an automation controller')) return;
    try {
      const controller=service.get(req.params.id);const result=controller?.controllerType==='PTS2'?await (async()=>{const started=performance.now();try{await dependencies.manager.start(req.params.id);return{success:true,timestamp:new Date().toISOString(),responseTimeMs:Math.round(performance.now()-started),message:'Authenticated read-only PTS-2 connection succeeded.'};}catch(error){return{success:false,timestamp:new Date().toISOString(),responseTimeMs:Math.round(performance.now()-started),message:error instanceof Error?error.message:String(error)};}})():await service.testConnection(req.params.id, req.authUser);
      if (!result) return res.status(404).json({ success: false, message: 'Controller not found.' });
      res.status(result.success ? 200 : 422).json(result);
    } catch (error) {
      console.error('[Automation] Controller test failed safely:', error);
      res.status(503).json({success:false,code:'CONTROLLER_TEST_FAILED',message:'Controller test could not be completed.'});
    }
  });

  router.get('/:id/logs', (req: any, res) => {
    if (dependencies.requirePermission(req, res, 'VIEW_AUTOMATION_LOGS', 'view automation controller logs')) return;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const logs = service.logs(req.params.id, limit);
    if (!logs) return res.status(404).json({ success: false, message: 'Controller not found.' });
    res.json(logs);
  });

  return router;
}
