import { INITIAL_APPROVALS } from '../../../data/initialData';
import type { ManagerApproval } from '../../../types';
import { fetchApi } from '../../../shared/api/http-client';

export type ApprovalResolutionAction = 'Approved' | 'Rejected';

export interface BulkApprovalResolutionResult {
  action: ApprovalResolutionAction;
  resolved: ManagerApproval[];
  affectedShiftIds: string[];
}

/** API actions owned by the Manager Approvals feature. */
export const managerApprovalsApi = {
  getAll: () => fetchApi<ManagerApproval[]>('/api/approvals', undefined, INITIAL_APPROVALS),

  resolve: (
    approvalId: string,
    action: ApprovalResolutionAction,
    managerId: string,
    managerName: string,
    managerPin: string,
    notes: string
  ) => fetchApi<ManagerApproval>('/api/approvals/resolve', {
    method: 'POST',
    body: JSON.stringify({ approvalId, action, managerId, managerName, managerPin, notes }),
  }),

  resolveMany: (
    approvalIds: string[],
    action: ApprovalResolutionAction,
    managerId: string,
    managerName: string,
    managerPin: string,
    notes: string
  ) => fetchApi<BulkApprovalResolutionResult>('/api/approvals/bulk-resolve', {
    method: 'POST',
    body: JSON.stringify({ approvalIds, action, managerId, managerName, managerPin, notes }),
  }),
};
