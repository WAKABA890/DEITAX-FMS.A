import { Router } from 'express';
import type { ManagerApproval, ShiftSession, User } from '../../../types';

export interface ApprovalRouterDependencies {
  db: any;
  getSqlite: () => any;
  getApprovals: () => ManagerApproval[];
  setApprovals: (approvals: ManagerApproval[]) => void;
  getShifts: () => ShiftSession[];
  setShifts: (shifts: ShiftSession[]) => void;
  setReconciliations: (reconciliations: any[]) => void;
  readPersistedManagerApprovals: () => ManagerApproval[];
  normalizeStoredReconciliation: (record: any) => any;
  isAdminRole: (role?: string | null) => boolean;
  hasPermission: (user: User | undefined, permission: any) => boolean;
  getUserById: (userId: string) => User | undefined;
  verifyStoredPin: (storedValue: unknown, submittedPin: unknown) => { valid: boolean };
  addAuditLog: (userId: string, userName: string, userRole: string, action: string, module: string, details: string, severity?: string) => void;
}

/** HTTP boundary for Manager Approval actions. */
export function createApprovalRouter(deps: ApprovalRouterDependencies) {
  const router = Router();
  let approvals = deps.getApprovals();
  let reconciliations: any[] = [];
  router.get('/', (req, res) => {
    const actor=(req as any).authUser as User|undefined;
    if(!actor)return res.status(401).json({message:'Authentication is required to view approvals.'});
    if(!deps.isAdminRole(actor.role)&&!deps.hasPermission(actor,'MANAGE_APPROVALS'))return res.status(403).json({message:'Admin, Super Admin, or MANAGE_APPROVALS permission is required.'});
    approvals = deps.readPersistedManagerApprovals(); deps.setApprovals(approvals);
    res.json(approvals);
  });
  
  router.post('/resolve', (req, res) => {
    const { approvalId, action, managerId, managerName, managerPin, notes } = req.body;
    const actor=(req as any).authUser as User|undefined;
    if(!actor)return res.status(401).json({message:'Authentication is required.'});
    if(!deps.isAdminRole(actor.role)&&!deps.hasPermission(actor,'MANAGE_APPROVALS'))return res.status(403).json({message:'Admin, Super Admin, or MANAGE_APPROVALS permission is required.'});
    if(String(managerId)!==actor.id)return res.status(403).json({message:'Approval must be authorized by the signed-in user.'});
    const mgr=deps.getUserById(actor.id);
    if(!mgr||!deps.verifyStoredPin(mgr.pin,managerPin).valid)return res.status(403).json({message:'Administrator PIN verification failed.'});
    if(action!=='Approved'&&action!=='Rejected')return res.status(400).json({message:'Action must be Approved or Rejected.'});
  
    approvals = deps.readPersistedManagerApprovals(); deps.setApprovals(approvals);
    const appItem = approvals.find((a) => a.id === approvalId) as any;
    if (!appItem) return res.status(404).json({ message: 'Approval item not found' });
  
    const resolvedAt = new Date().toISOString();
    const isReadingReview = appItem.reviewScope === 'READING' || Boolean(appItem.readingVarianceId);
    if (isReadingReview) {
      try {
        deps.getSqlite().transaction(() => {
          const sqlite = deps.getSqlite();
          sqlite.prepare("UPDATE manager_approvals SET status=?,manager_id=?,manager_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(action, mgr.id, notes || '', approvalId);
          if (appItem.readingVarianceId) {
            sqlite.prepare("UPDATE reading_variances SET status=?,reviewed_by=?,reviewed_at=?,resolved_by=?,resolved_at=?,resolution_notes=? WHERE id=?")
              .run(action === 'Approved' ? 'Resolved' : 'Reviewed', mgr.id, resolvedAt, action === 'Approved' ? mgr.id : null, action === 'Approved' ? resolvedAt : null, notes || '', appItem.readingVarianceId);
          } else if (appItem.shiftId) {
            sqlite.prepare("UPDATE reading_variances SET status=?,reviewed_by=?,reviewed_at=?,resolved_by=?,resolved_at=?,resolution_notes=? WHERE shift_id=? AND status<>'Resolved'")
              .run(action === 'Approved' ? 'Resolved' : 'Reviewed', mgr.id, resolvedAt, action === 'Approved' ? mgr.id : null, action === 'Approved' ? resolvedAt : null, notes || '', appItem.shiftId);
          }
        })();
      } catch (error) {
        return res.status(500).json({ message: 'Meter review could not be saved.' });
      }
      approvals = deps.readPersistedManagerApprovals(); deps.setApprovals(approvals);
      const updated = approvals.find((item) => item.id === approvalId) || { ...appItem, status: action, managerId: mgr.id, managerNotes: notes || '' };
      deps.addAuditLog(mgr.id, mgr.name, mgr.role, 'APPROVAL_' + action.toUpperCase(), 'Approvals', action + ' meter evidence review ' + appItem.id + '; physical meters and shift boundaries retained. ' + (notes || ''));
      return res.json(updated);
    }
  
    // A SHIFT approval already contains every shift-linked exception. It can be
    // resolved as one decision; individual reading rows are settled together.
    if (action === 'Approved' && appItem.shiftId && appItem.reviewScope !== 'SHIFT' && deps.getSqlite().prepare("SELECT 1 FROM manager_approvals WHERE shift_id=? AND review_scope='READING' AND status<>'Approved'").get(appItem.shiftId)) {
      return res.status(409).json({ message: 'Resolve the nozzle reading and unattended activity reviews before approving this reconciliation.' });
    }
    const nextStatus = action === 'Approved' ? 'Approved' : 'Rejected';
    const reconciliationBeforeResolution = appItem.shiftId
      ? deps.getSqlite().prepare('SELECT id FROM reconciliations WHERE shift_id=? ORDER BY created_at DESC, id DESC LIMIT 1').get(appItem.shiftId)
      : null;
    const updatesShiftReconciliation = appItem.reviewScope === 'SHIFT' || Boolean(reconciliationBeforeResolution);
  
    try {
      const sqlite = deps.getSqlite();
      sqlite.transaction(() => {
        sqlite.prepare("UPDATE manager_approvals SET status=?,manager_id=?,manager_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(nextStatus, mgr.id, notes || '', approvalId);
        if (updatesShiftReconciliation && appItem.shiftId) {
          sqlite.prepare("UPDATE reading_variances SET status=?,reviewed_by=?,reviewed_at=?,resolved_by=?,resolved_at=?,resolution_notes=? WHERE shift_id=? AND status<>'Resolved'")
            .run(action === 'Approved' ? 'Resolved' : 'Reviewed', mgr.id, resolvedAt, action === 'Approved' ? mgr.id : null, action === 'Approved' ? resolvedAt : null, notes || '', appItem.shiftId);
          // Older data may still contain child reading/transaction approvals. The
          // shift-level decision settles every pending item linked to this shift.
          sqlite.prepare("UPDATE manager_approvals SET status=?,manager_id=?,manager_notes=?,updated_at=CURRENT_TIMESTAMP WHERE shift_id=? AND id<>? AND status='Pending'")
            .run(nextStatus, mgr.id, notes || '', appItem.shiftId, approvalId);
          const reconciliation = sqlite.prepare('SELECT id, variance_notes FROM reconciliations WHERE shift_id=? ORDER BY created_at DESC, id DESC LIMIT 1').get(appItem.shiftId) as any;
          if (reconciliation) {
            let varianceNotes: any = {};
            try { varianceNotes = reconciliation.variance_notes ? JSON.parse(reconciliation.variance_notes) : {}; } catch { varianceNotes = {}; }
            varianceNotes.managerNotes = notes || '';
            sqlite.prepare('UPDATE reconciliations SET status=?, approved_by=?, approved_by_name=?, variance_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
              .run(nextStatus, mgr.id, mgr.name, JSON.stringify(varianceNotes), reconciliation.id);
          }
        }
      })();
    } catch (error) {
      console.error('Error updating approval and reconciliation in database:', error);
      return res.status(500).json({ message: 'Approval and reconciliation could not be saved.' });
    }
  
    if (updatesShiftReconciliation && appItem.shiftId) {
      const shift = deps.getShifts().find((item) => item.id === appItem.shiftId) as any;
      if (shift) {
        shift.approvalStatus = nextStatus;
        shift.status = action === 'Approved' ? 'Completed' : 'Flagged';
        deps.db.shiftQueries.update(shift.id, {
          status: shift.status,
          endTime: shift.endTime,
          closingCash: shift.actualCashCount ?? null,
        } as any);
      }
    }
  
    reconciliations = (deps.db.reconciliationQueries.all() as any[]).map(deps.normalizeStoredReconciliation); deps.setReconciliations(reconciliations);
    approvals = deps.readPersistedManagerApprovals(); deps.setApprovals(approvals);
    const updated = approvals.find((item) => item.id === approvalId) || { ...appItem, status: nextStatus, managerId: mgr.id, managerNotes: notes || '' };
    deps.addAuditLog(
      mgr.id,
      mgr.name,
      mgr.role,
      'APPROVAL_' + action.toUpperCase(),
      'Approvals',
      'Manager ' + mgr.name + ' ' + action + ' item ' + appItem.id + ' (' + appItem.type + '): ' + (notes || '')
    );
  
    res.json(updated);
  });
  
  router.post('/bulk-resolve', (req, res) => {
    const { approvalIds, action, managerId, managerName, managerPin, notes } = req.body;
    const actor = (req as any).authUser as User | undefined;
    if (!actor) return res.status(401).json({ message: 'Authentication is required.' });
    if (!deps.isAdminRole(actor.role) && !deps.hasPermission(actor, 'MANAGE_APPROVALS')) return res.status(403).json({ message: 'Admin, Super Admin, or MANAGE_APPROVALS permission is required.' });
    if (String(managerId) !== actor.id) return res.status(403).json({ message: 'Bulk approval must be authorized by the signed-in user.' });
    if (action !== 'Approved' && action !== 'Rejected') return res.status(400).json({ message: 'Action must be Approved or Rejected.' });
    const managerNotes = String(notes || '').trim();
    if (!managerNotes) return res.status(400).json({ message: 'Resolution notes are required for a bulk approval.' });
    const ids = Array.isArray(approvalIds)
      ? [...new Set(approvalIds.map((id: unknown) => String(id || '').trim()).filter(Boolean))]
      : [];
    if (ids.length === 0) return res.status(400).json({ message: 'Select at least one pending approval.' });
    if (ids.length > 100) return res.status(400).json({ message: 'A bulk approval may contain at most 100 records.' });
    const mgr = deps.getUserById(actor.id);
    if (!mgr || !deps.verifyStoredPin(mgr.pin, managerPin).valid) return res.status(403).json({ message: 'Administrator PIN verification failed.' });
  
    approvals = deps.readPersistedManagerApprovals(); deps.setApprovals(approvals);
    const selected = ids.map((id) => approvals.find((approval) => approval.id === id)).filter(Boolean) as ManagerApproval[];
    if (selected.length !== ids.length) return res.status(404).json({ message: 'One or more approval records were not found.' });
    if (selected.some((approval) => approval.status !== 'Pending')) return res.status(409).json({ message: 'Bulk approval can only resolve records that are still pending.' });
  
    const sqlite = deps.getSqlite();
    const selectedIds = new Set(ids);
    if (action === 'Approved') {
      for (const approval of selected) {
        const isReadingReview = approval.reviewScope === 'READING' || Boolean(approval.readingVarianceId);
        if (isReadingReview || approval.reviewScope === 'SHIFT' || !approval.shiftId) continue;
        const unselectedReadingReview = (sqlite.prepare("SELECT id FROM manager_approvals WHERE shift_id=? AND review_scope='READING' AND status<>'Approved'").all(approval.shiftId) as any[])
          .some((item) => !selectedIds.has(String(item.id)));
        if (unselectedReadingReview) return res.status(409).json({ message: 'Select or resolve every pending nozzle-reading review for a shift before approving its related approval.' });
      }
    }
  
    const resolvedAt = new Date().toISOString();
    const nextStatus = action === 'Approved' ? 'Approved' : 'Rejected';
    const nextShiftStatus = action === 'Approved' ? 'Completed' : 'Flagged';
    const affectedShiftIds = new Set<string>();
    const priority = (approval: ManagerApproval) => approval.reviewScope === 'READING' || approval.readingVarianceId ? 0 : approval.reviewScope === 'SHIFT' ? 2 : 1;
  
    try {
      sqlite.transaction(() => {
        for (const approval of [...selected].sort((a, b) => priority(a) - priority(b))) {
          const pending = sqlite.prepare("SELECT id FROM manager_approvals WHERE id=? AND status='Pending'").get(approval.id);
          if (!pending) throw new Error('An approval record is no longer pending. Refresh and try again.');
          sqlite.prepare("UPDATE manager_approvals SET status=?,manager_id=?,manager_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Pending'")
            .run(nextStatus, mgr.id, managerNotes, approval.id);
  
          const isReadingReview = approval.reviewScope === 'READING' || Boolean(approval.readingVarianceId);
          if (isReadingReview) {
            if (approval.readingVarianceId) {
              sqlite.prepare("UPDATE reading_variances SET status=?,reviewed_by=?,reviewed_at=?,resolved_by=?,resolved_at=?,resolution_notes=? WHERE id=?")
                .run(action === 'Approved' ? 'Resolved' : 'Reviewed', mgr.id, resolvedAt, action === 'Approved' ? mgr.id : null, action === 'Approved' ? resolvedAt : null, managerNotes, approval.readingVarianceId);
            } else if (approval.shiftId) {
              sqlite.prepare("UPDATE reading_variances SET status=?,reviewed_by=?,reviewed_at=?,resolved_by=?,resolved_at=?,resolution_notes=? WHERE shift_id=? AND status<>'Resolved'")
                .run(action === 'Approved' ? 'Resolved' : 'Reviewed', mgr.id, resolvedAt, action === 'Approved' ? mgr.id : null, action === 'Approved' ? resolvedAt : null, managerNotes, approval.shiftId);
            }
            continue;
          }
  
          if (!approval.shiftId) continue;
          const reconciliation = sqlite.prepare('SELECT id, variance_notes FROM reconciliations WHERE shift_id=? ORDER BY created_at DESC, id DESC LIMIT 1').get(approval.shiftId) as any;
          const updatesShiftReconciliation = approval.reviewScope === 'SHIFT' || Boolean(reconciliation);
          if (!updatesShiftReconciliation) continue;
  
          sqlite.prepare("UPDATE reading_variances SET status=?,reviewed_by=?,reviewed_at=?,resolved_by=?,resolved_at=?,resolution_notes=? WHERE shift_id=? AND status<>'Resolved'")
            .run(action === 'Approved' ? 'Resolved' : 'Reviewed', mgr.id, resolvedAt, action === 'Approved' ? mgr.id : null, action === 'Approved' ? resolvedAt : null, managerNotes, approval.shiftId);
          if (approval.reviewScope === 'SHIFT') {
            sqlite.prepare("UPDATE manager_approvals SET status=?,manager_id=?,manager_notes=?,updated_at=CURRENT_TIMESTAMP WHERE shift_id=? AND id<>? AND status='Pending'")
              .run(nextStatus, mgr.id, managerNotes, approval.shiftId, approval.id);
          }
          if (reconciliation) {
            let varianceNotes: any = {};
            try { varianceNotes = reconciliation.variance_notes ? JSON.parse(reconciliation.variance_notes) : {}; } catch { varianceNotes = {}; }
            varianceNotes.managerNotes = managerNotes;
            sqlite.prepare('UPDATE reconciliations SET status=?, approved_by=?, approved_by_name=?, variance_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
              .run(nextStatus, mgr.id, mgr.name, JSON.stringify(varianceNotes), reconciliation.id);
          }
          sqlite.prepare('UPDATE shifts SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nextShiftStatus, approval.shiftId);
          affectedShiftIds.add(approval.shiftId);
        }
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bulk approval could not be saved.';
      return res.status(message.includes('no longer pending') ? 409 : 500).json({ message });
    }
  
    const updatedShifts = deps.getShifts().map((shift) => affectedShiftIds.has(shift.id)
    ? { ...shift, status: nextShiftStatus as ShiftSession['status'], approvalStatus: nextStatus as ShiftSession['approvalStatus'] }
    : shift);
  deps.setShifts(updatedShifts);
    reconciliations = (deps.db.reconciliationQueries.all() as any[]).map(deps.normalizeStoredReconciliation); deps.setReconciliations(reconciliations);
    approvals = deps.readPersistedManagerApprovals(); deps.setApprovals(approvals);
    const resolved = approvals.filter((approval) => ids.includes(approval.id));
    deps.addAuditLog(mgr.id, mgr.name, mgr.role, 'BULK_APPROVAL_' + action.toUpperCase(), 'Approvals', 'Bulk ' + action.toLowerCase() + ' ' + ids.length + ' approval record' + (ids.length === 1 ? '' : 's') + '.');
    res.json({ action, resolved, affectedShiftIds: [...affectedShiftIds] });
  });
  
  
  return router;
}
