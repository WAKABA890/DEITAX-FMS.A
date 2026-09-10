import { randomUUID } from 'node:crypto';
import type { User } from '../../types.js';
import type { ControllerRecord, ControllerRepository, ControllerWriteInput } from './controller-repository.js';
import { testSimulatorConnection } from './simulator-connection-tester.js';

type AuditWriter = (
  userId: string,
  userName: string,
  userRole: string,
  action: string,
  module: 'Automation',
  details: string,
  severity?: 'Info' | 'Warning' | 'Critical',
) => unknown;

const auditSummary = (controller: ControllerRecord) => ({
  id: controller.id,
  stationId: controller.stationId,
  name: controller.name,
  controllerType: controller.controllerType,
  host: controller.host,
  port: controller.port,
  connectionType: controller.connectionType,
  timeoutMs: controller.timeoutMs,
  enabled: controller.enabled,
  status: controller.status,
  authenticationConfigured: controller.authenticationConfigured,
  capabilities: controller.capabilities,
});

const changedFields = (before: ControllerRecord, after: ControllerRecord) =>
  Object.keys(auditSummary(after)).filter((key) =>
    JSON.stringify((auditSummary(before) as any)[key]) !== JSON.stringify((auditSummary(after) as any)[key]),
  );

export class ControllerService {
  constructor(
    private readonly repository: ControllerRepository,
    private readonly writeAudit: AuditWriter,
  ) {}

  list() {
    return this.repository.list();
  }

  get(id: string) {
    return this.repository.findById(id);
  }

  create(input: ControllerWriteInput, actor: User) {
    if (!this.repository.stationExists(input.stationId)) throw new Error('The selected station does not exist.');
    const controller = this.repository.create(input);
    const correlationId = randomUUID();
    this.writeAudit(actor.id, actor.name, actor.role, 'AUTOMATION_CONTROLLER_CREATED', 'Automation', JSON.stringify({
      correlationId,
      controller: auditSummary(controller),
    }));
    this.repository.addLog({
      controllerId: controller.id,
      level: 'INFO',
      category: 'CONFIGURATION',
      message: 'Controller configuration created.',
      details: { controllerType: controller.controllerType, enabled: false },
      correlationId,
    });
    return controller;
  }

  update(id: string, input: ControllerWriteInput, actor: User) {
    const before = this.repository.findById(id);
    if (!before) return null;
    if (!this.repository.stationExists(input.stationId)) throw new Error('The selected station does not exist.');
    const after = this.repository.update(id, input)!;
    const correlationId = randomUUID();
    this.writeAudit(actor.id, actor.name, actor.role, 'AUTOMATION_CONTROLLER_UPDATED', 'Automation', JSON.stringify({
      correlationId,
      controllerId: id,
      changedFields: changedFields(before, after),
      previous: auditSummary(before),
      next: auditSummary(after),
    }));
    this.repository.addLog({
      controllerId: id,
      level: 'INFO',
      category: 'CONFIGURATION',
      message: 'Controller configuration updated.',
      details: { changedFields: changedFields(before, after) },
      correlationId,
    });
    return after;
  }

  setEnabled(id: string, enabled: boolean, actor: User) {
    const before = this.repository.findById(id);
    if (!before) return null;
    const after = this.repository.setEnabled(id, enabled)!;
    const correlationId = randomUUID();
    const action = enabled ? 'AUTOMATION_CONTROLLER_ENABLED' : 'AUTOMATION_CONTROLLER_DISABLED';
    this.writeAudit(actor.id, actor.name, actor.role, action, 'Automation', JSON.stringify({
      correlationId,
      controllerId: id,
      previous: { enabled: before.enabled, status: before.status },
      next: { enabled: after.enabled, status: after.status },
    }));
    this.repository.addLog({
      controllerId: id,
      level: 'INFO',
      category: 'LIFECYCLE',
      message: enabled ? 'Controller enabled; no hardware runtime is installed.' : 'Controller disabled.',
      details: { enabled, status: after.status },
      correlationId,
    });
    return after;
  }

  async testConnection(id: string, actor: User) {
    const controller = this.repository.findById(id);
    if (!controller) return null;
    const correlationId = randomUUID();
    this.writeAudit(actor.id, actor.name, actor.role, 'AUTOMATION_CONTROLLER_TEST_REQUESTED', 'Automation', JSON.stringify({
      correlationId,
      controllerId: controller.id,
      controllerType: controller.controllerType,
      simulatorOnly: true,
    }));

    try {
      const result = await testSimulatorConnection(controller);
      this.repository.recordConnectionTest(id, {
        success: result.success,
        timestamp: result.timestamp,
        error: result.success ? undefined : result.message,
      });
      this.repository.addLog({
        controllerId: id,
        level: result.success ? 'INFO' : 'ERROR',
        category: 'CONNECTION_TEST',
        message: result.message,
        details: { success: result.success, responseTimeMs: result.responseTimeMs, simulatorOnly: true },
        correlationId,
      });
      return { ...result, correlationId, controller: this.repository.findById(id) };
    } catch (error) {
      const timestamp = new Date().toISOString();
      const message = error instanceof Error ? error.message : 'Simulator connection test failed.';
      this.repository.recordConnectionTest(id, { success: false, timestamp, error: message });
      this.repository.addLog({
        controllerId: id,
        level: 'ERROR',
        category: 'CONNECTION_TEST',
        message,
        details: { success: false, simulatorOnly: true },
        correlationId,
      });
      return {
        success: false,
        timestamp,
        responseTimeMs: 0,
        controllerId: id,
        message,
        correlationId,
        controller: this.repository.findById(id),
      };
    }
  }

  logs(id: string, limit?: number) {
    if (!this.repository.findById(id)) return null;
    return this.repository.logs(id, limit);
  }
}

