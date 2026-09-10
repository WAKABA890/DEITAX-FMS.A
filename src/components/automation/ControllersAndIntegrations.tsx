import React, { useEffect, useMemo, useState } from 'react';
import { Cable, CheckCircle2, CircleOff, Edit3, FlaskConical, History, Plus, RefreshCw, Server, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AUTOMATION_CAPABILITIES, type AutomationCapability } from '../../automation/types/capabilities';
import type { StationSettings, User } from '../../types';
import { usePermissions } from '../../hooks/usePermissions';
import { automationApi, adapterRuntimeApi, type AutomationControllerDto, type AutomationLogDto, type ControllerInput, type ControllerType } from '../../services/automationApi';

interface Props {
  currentUser: User;
  stationSettings: StationSettings;
}

const emptyInput = (stationId: string): ControllerInput => ({
  stationId,
  name: '',
  controllerType: 'SIMULATOR',
  host: null,
  port: null,
  connectionType: 'SIMULATOR',
  timeoutMs: 5000,
  configuration: { simulatorMode: 'SUCCESS' },
  capabilities: ['PUMP_STATUS_READ', 'NOZZLE_STATUS_READ', 'EQUIPMENT_HEALTH_READ'],
  firmwareVersion: null,
  credential: undefined,
});

const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Never';

const statusClass: Record<string, string> = {
  ONLINE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  OFFLINE: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  CONNECTING: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  ERROR: 'bg-red-500/15 text-red-300 border-red-500/30',
  DISABLED: 'bg-slate-700 text-slate-400 border-slate-600',
  UNKNOWN: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

export const ControllersAndIntegrations: React.FC<Props> = ({ currentUser, stationSettings }) => {
  const { canManageControllers, canViewAutomationLogs } = usePermissions(currentUser);
  const stationId = (stationSettings as any).id || 'station-1';
  const [controllers, setControllers] = useState<AutomationControllerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AutomationControllerDto | null>(null);
  const [form, setForm] = useState<ControllerInput>(() => emptyInput(stationId));
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<AutomationControllerDto | null>(null);
  const [logs, setLogs] = useState<AutomationLogDto[]>([]);
  const [testMessage, setTestMessage] = useState<Record<string, string>>({});
  const [runtime, setRuntime] = useState<Record<string, any>>({});

  const loadControllers = async () => {
    setLoading(true);
    setError('');
    try {
      const loaded=await automationApi.listControllers();setControllers(loaded);const statuses=await Promise.all(loaded.map(async c=>[c.id,await adapterRuntimeApi.status(c.id).catch(()=>null)] as const));setRuntime(Object.fromEntries(statuses));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load controllers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadControllers(); }, []);

  const summary = useMemo(() => ({
    total: controllers.length,
    enabled: controllers.filter((controller) => controller.enabled).length,
    error: controllers.filter((controller) => controller.status === 'ERROR').length,
  }), [controllers]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyInput(stationId));
    setShowForm(true);
  };

  const openEdit = (controller: AutomationControllerDto) => {
    setEditing(controller);
    setForm({
      stationId: controller.stationId,
      name: controller.name,
      controllerType: controller.controllerType,
      host: controller.host,
      port: controller.port,
      connectionType: controller.connectionType,
      timeoutMs: controller.timeoutMs,
      configuration: controller.configuration,
      capabilities: controller.capabilities,
      firmwareVersion: controller.firmwareVersion,
      credential: undefined,
    });
    setShowForm(true);
  };

  const setControllerType = (controllerType: ControllerType) => {
    const simulator = controllerType === 'SIMULATOR';
    setForm((current) => ({
      ...current,
      controllerType,
      connectionType: simulator ? 'SIMULATOR' : controllerType === 'PTS2' ? 'HTTP' : 'TCP',
      host: simulator ? null : current.host,
      port: simulator ? null : current.port,
      configuration: simulator ? { simulatorMode: 'SUCCESS' } : {},
    }));
  };

  const toggleCapability = (capability: AutomationCapability) => setForm((current) => ({
    ...current,
    capabilities: current.capabilities.includes(capability)
      ? current.capabilities.filter((item) => item !== capability)
      : [...current.capabilities, capability],
  }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) await automationApi.updateController(editing.id, form);
      else await automationApi.createController(form);
      toast.success(editing ? 'Controller updated.' : 'Controller registered.');
      setShowForm(false);
      await loadControllers();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to save controller.');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (controller: AutomationControllerDto) => {
    setBusyId(controller.id);
    try {
      if (controller.enabled) await automationApi.disableController(controller.id);
      else await automationApi.enableController(controller.id);
      await loadControllers();
    } catch (toggleError) {
      toast.error(toggleError instanceof Error ? toggleError.message : 'Unable to change controller state.');
    } finally {
      setBusyId(null);
    }
  };

  const testConnection = async (controller: AutomationControllerDto) => {
    setBusyId(controller.id);
    try {
      const result = await automationApi.testController(controller.id);
      setTestMessage((current) => ({ ...current, [controller.id]: `${result.message} (${result.responseTimeMs} ms)` }));
      toast.success(result.message);
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : 'Connection test failed.';
      setTestMessage((current) => ({ ...current, [controller.id]: message }));
      toast.error(message);
    } finally {
      setBusyId(null);
      await loadControllers();
    }
  };

  const viewLogs = async (controller: AutomationControllerDto) => {
    setLogsFor(controller);
    try { setLogs(await automationApi.getControllerLogs(controller.id)); }
    catch (logError) { toast.error(logError instanceof Error ? logError.message : 'Unable to load logs.'); }
  };

  return (
    <div className="space-y-5 pb-12">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Cable className="w-6 h-6 text-blue-400" />Controllers & Integrations</h2>
          <p className="text-xs text-slate-400 mt-1">Controller configuration with simulator support and read-only PTS-2 monitoring. Hardware control commands are disabled.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{summary.total} configured · {summary.enabled} enabled · {summary.error} error</span>
          <button onClick={() => void loadControllers()} className="p-2 rounded-lg bg-slate-800 text-slate-300" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          {canManageControllers && <button onClick={openCreate} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2"><Plus className="w-4 h-4" />Register Controller</button>}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 p-4 text-sm">{error}</div>}
      {loading ? <div className="text-sm text-slate-400 p-8 text-center">Loading controller configurations…</div> : controllers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-12 text-center text-slate-400"><Server className="w-10 h-10 mx-auto mb-3" />No controllers configured. Disabled and offline controllers will remain visible here.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {controllers.map((controller) => (
            <div key={controller.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-bold text-slate-100">{controller.name}</h3><p className="text-xs text-slate-400">{controller.controllerType} · {controller.stationName}</p></div>
                <span className={`px-2.5 py-1 rounded-full border text-[10px] font-bold ${statusClass[controller.status] || statusClass.UNKNOWN}`}>{controller.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <span className="text-slate-500">Endpoint</span><span className="text-slate-300">{controller.connectionType === 'SIMULATOR' ? 'Controlled simulator' : `${controller.host}:${controller.port}`}</span>
                <span className="text-slate-500">Configured state</span><span className="text-slate-300">{controller.enabled ? 'Enabled' : 'Disabled'}</span>
                <span className="text-slate-500">Timeout</span><span className="text-slate-300">{controller.timeoutMs} ms</span>
                <span className="text-slate-500">Last communication</span><span className="text-slate-300">{formatTime(controller.lastCommunicationAt)}</span>
                <span className="text-slate-500">Last successful test</span><span className="text-slate-300">{formatTime(controller.lastSuccessfulConnectionAt)}</span>
                <span className="text-slate-500">Authentication</span><span className="text-slate-300">{controller.authenticationConfigured ? 'Configured' : 'Not configured'}</span>
                <span className="text-slate-500">Created</span><span className="text-slate-300">{formatTime(controller.createdAt)}</span>
                <span className="text-slate-500">Updated</span><span className="text-slate-300">{formatTime(controller.updatedAt)}</span>
                <span className="text-slate-500">Adapter runtime</span><span className="text-slate-300">{runtime[controller.id]?.runtimeStatus || 'DISCONNECTED'} · {runtime[controller.id]?.adapterVersion || 'Not loaded'}</span>
                <span className="text-slate-500">Adapter health</span><span className={runtime[controller.id]?.health?.healthy ? 'text-emerald-300' : 'text-amber-300'}>{runtime[controller.id]?.health ? `${runtime[controller.id].health.healthy ? 'Healthy' : 'Not healthy'} · ${runtime[controller.id].health.latencyMs ?? '—'} ms · failures ${runtime[controller.id].health.consecutiveFailures}` : 'Runtime not started'}</span>
              </div>
              <div><p className="text-[10px] uppercase text-slate-500 mb-1">Capabilities</p><div className="flex flex-wrap gap-1">{controller.capabilities.length ? controller.capabilities.map((capability) => <span key={capability} className="px-2 py-1 bg-slate-800 rounded text-[10px] text-slate-300">{capability}</span>) : <span className="text-xs text-slate-500">Unknown</span>}</div></div>
              {controller.lastError && <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2">Last error: {controller.lastError}</div>}
              {testMessage[controller.id] && <div className="text-xs text-blue-300">{testMessage[controller.id]}</div>}
              <div className="flex flex-wrap gap-2 pt-1">
                {canManageControllers && <button onClick={() => openEdit(controller)} className="px-3 py-2 bg-slate-800 rounded-lg text-xs text-slate-200 flex items-center gap-1"><Edit3 className="w-3.5 h-3.5" />Edit</button>}
                {canManageControllers && <button disabled={busyId === controller.id} onClick={() => void toggleEnabled(controller)} className="px-3 py-2 bg-slate-800 rounded-lg text-xs text-slate-200 flex items-center gap-1">{controller.enabled ? <CircleOff className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}{controller.enabled ? 'Disable' : 'Enable'}</button>}
                {canManageControllers && <button disabled={busyId === controller.id || !['SIMULATOR','PTS2'].includes(controller.controllerType)} onClick={() => void testConnection(controller)} className="px-3 py-2 bg-blue-600/20 border border-blue-500/30 rounded-lg text-xs text-blue-300 flex items-center gap-1 disabled:opacity-40" title="Run a safe connection test"><FlaskConical className="w-3.5 h-3.5" />Test Connection</button>}
                {canManageControllers && ['SIMULATOR','PTS2'].includes(controller.controllerType) && <button disabled={busyId === controller.id} onClick={async()=>{setBusyId(controller.id);try{runtime[controller.id]?.runtimeStatus==='CONNECTED'?await adapterRuntimeApi.restart(controller.id):await adapterRuntimeApi.connect(controller.id);await loadControllers();}catch(e){toast.error(e instanceof Error?e.message:'Adapter action failed.');}finally{setBusyId(null);}}} className="px-3 py-2 bg-emerald-600/20 border border-emerald-500/30 rounded-lg text-xs text-emerald-300">{runtime[controller.id]?.runtimeStatus==='CONNECTED'?'Restart Adapter':'Connect Adapter'}</button>}
                {canViewAutomationLogs && <button onClick={() => void viewLogs(controller)} className="px-3 py-2 bg-slate-800 rounded-lg text-xs text-slate-200 flex items-center gap-1"><History className="w-3.5 h-3.5" />History & Logs</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"><form onSubmit={submit} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex justify-between"><div><h3 className="font-bold text-slate-100">{editing ? 'Edit Controller' : 'Register Controller'}</h3><p className="text-xs text-slate-400">PTS-2 credentials are encrypted and never displayed again. Integration is read-only.</p></div><button type="button" onClick={() => setShowForm(false)}><XCircle className="w-5 h-5 text-slate-400" /></button></div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="text-xs text-slate-400">Controller name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100" /></label>
          <label className="text-xs text-slate-400">Controller type<select value={form.controllerType} onChange={(e) => setControllerType(e.target.value as ControllerType)} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100">{['SIMULATOR', 'GENERIC', 'PTS2', 'WAYNE', 'OTHER'].map((type) => <option key={type}>{type}</option>)}</select></label>
          {form.controllerType !== 'SIMULATOR' && <><label className="text-xs text-slate-400">Host / IP<input required value={form.host || ''} onChange={(e) => setForm({ ...form, host: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100" placeholder="192.168.1.20" /></label><label className="text-xs text-slate-400">Port<input required type="number" min="1" max="65535" value={form.port ?? ''} onChange={(e) => setForm({ ...form, port: e.target.value ? Number(e.target.value) : null })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100" /></label></>}
          <label className="text-xs text-slate-400">Connection type<select value={form.connectionType} disabled={form.controllerType === 'SIMULATOR'} onChange={(e) => setForm({ ...form, connectionType: e.target.value as any })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100"><option>SIMULATOR</option><option>TCP</option><option>HTTP</option><option>HTTPS</option></select></label>
          <label className="text-xs text-slate-400">Timeout (ms)<input required type="number" min="100" max="60000" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100" /></label>
          {form.controllerType === 'SIMULATOR' && <label className="text-xs text-slate-400">Simulator result<select value={String(form.configuration.simulatorMode || 'SUCCESS')} onChange={(e) => setForm({ ...form, configuration: { simulatorMode: e.target.value } })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100"><option value="SUCCESS">Successful test</option><option value="FAILURE">Controlled failure</option></select></label>}
          {form.controllerType === 'PTS2' && <><label className="text-xs text-slate-400">PTS-2 username<input required={!editing?.authenticationConfigured} autoComplete="off" value={form.credential?.username||''} onChange={e=>setForm({...form,credential:{username:e.target.value,password:form.credential?.password||'',authenticationType:'BASIC'}})} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100" placeholder={editing?.authenticationConfigured?'Leave blank to keep existing credentials':''}/></label><label className="text-xs text-slate-400">PTS-2 password<input required={!editing?.authenticationConfigured} type="password" autoComplete="new-password" value={form.credential?.password||''} onChange={e=>setForm({...form,credential:{username:form.credential?.username||'',password:e.target.value,authenticationType:'BASIC'}})} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100" placeholder={editing?.authenticationConfigured?'Leave blank to keep existing credentials':''}/></label></>}
          <label className="text-xs text-slate-400">Firmware/version (metadata only)<input value={form.firmwareVersion || ''} onChange={(e) => setForm({ ...form, firmwareVersion: e.target.value || null })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100" /></label>
        </div>
        <div><p className="text-xs text-slate-400 mb-2">Known read-only capabilities</p><div className="grid sm:grid-cols-2 gap-2">{AUTOMATION_CAPABILITIES.map((capability) => <label key={capability} className="text-xs text-slate-300 flex items-center gap-2"><input type="checkbox" checked={form.capabilities.includes(capability)} onChange={() => toggleCapability(capability)} />{capability}</label>)}</div></div>
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-xs bg-slate-800 rounded-lg text-slate-200">Cancel</button><button disabled={saving} className="px-4 py-2 text-xs bg-blue-600 rounded-lg text-white font-bold">{saving ? 'Saving…' : 'Save Controller'}</button></div>
      </form></div>}

      {logsFor && <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"><div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-6"><div className="flex justify-between mb-4"><div><h3 className="font-bold text-slate-100">Connection History & Logs</h3><p className="text-xs text-slate-400">{logsFor.name}</p></div><button onClick={() => setLogsFor(null)}><XCircle className="w-5 h-5 text-slate-400" /></button></div><div className="space-y-2">{logs.length ? logs.map((log) => <div key={log.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs"><div className="flex justify-between"><span className={log.level === 'ERROR' ? 'text-red-300' : 'text-blue-300'}>{log.level} · {log.category}</span><span className="text-slate-500">{formatTime(log.timestamp)}</span></div><p className="text-slate-300 mt-1">{log.message}</p><p className="text-slate-600 mt-1 font-mono">{log.correlationId || ''}</p></div>) : <p className="text-sm text-slate-500">No controller logs recorded.</p>}</div></div></div>}
    </div>
  );
};
