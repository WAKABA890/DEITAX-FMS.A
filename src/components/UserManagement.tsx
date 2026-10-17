import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  Plus,
  Search,
  Filter,
  ShieldCheck,
  Lock,
  Power,
  Eye,
  Trash2,
  CheckCircle2,
  Clock3,
  Calendar,
  Mail,
  Phone,
  Briefcase,
  Building2,
  X,
  Loader2,
  RefreshCw,
  Check,
  Edit3,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

import { Permission, PERMISSIONS, ShiftSession, User } from '../types';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { AppDialog } from './AppDialog';
import { api } from '../services/api';

// =========================================================
// CONSTANTS
// =========================================================

const SUPER_ADMIN_ROLE = 'Super Admin';
const DEFAULT_ROLE = 'Normal User';
const PAGE_SIZE = 10;
const PIN_REGEX = /^\d{4,6}$/;

type UserStatus = 'All' | 'Active' | 'Inactive' | 'Suspended';
type AccountStatus = 'Active' | 'Inactive' | 'Suspended';
type ClockStatus = 'All' | 'Clocked In' | 'Clocked Out';

// =========================================================
// VALIDATION
// =========================================================

const userFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Full name is required'),
    username: z.string().optional(),
    email: z.string().trim().email('Invalid email address'),
    phone: z.string().optional(),
    role: z.string().trim().min(1, 'Role is required'),
    pin: z.string().regex(PIN_REGEX, 'PIN must be 4-6 digits only'),
    confirmPin: z.string().regex(PIN_REGEX, 'PIN must be 4-6 digits only'),
    department: z.string().optional(),
    jobTitle: z.string().optional(),
    employeeId: z.string().optional(),
    status: z.enum(['Active', 'Inactive', 'Suspended']),
    isSuperAdmin: z.boolean().default(false),
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: 'PINs do not match',
    path: ['confirmPin'],
  });

type UserFormData = z.infer<typeof userFormSchema>;

// =========================================================
// HELPERS
// =========================================================

const normalizeAccountStatus = (user: User): AccountStatus => {
  if (
    user.status === 'Active' ||
    user.status === 'Inactive' ||
    user.status === 'Suspended'
  ) {
    return user.status;
  }
  return user.active === false ? 'Inactive' : 'Active';
};

const getClockStatus = (
  user: User,
  shifts: ShiftSession[]
): 'Clocked In' | 'Clocked Out' => {
  const activeShift = shifts.find(
    (shift) => shift.staffId === user.id && shift.status === 'Active'
  );
  return activeShift ? 'Clocked In' : 'Clocked Out';
};

const getInitials = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || 'U';
};

const getRoleOptions = (users: User[], configuredRoles: Array<{name:string;status:string}>=[]) => {
  const roles = new Set<string>();
  configuredRoles.filter(role=>role.status==='ACTIVE').forEach(role=>roles.add(role.name));
  users.forEach((user) => {
    if (user.role?.trim()) {
      roles.add(user.role);
    }
  });
  return Array.from(roles).sort((a, b) => a.localeCompare(b));
};

// =========================================================
// PERMISSION GROUPS (hierarchical: View + Actions)
// =========================================================

interface PermissionGroup {
  tabLabel: string;
  viewPermission: Permission;
  actionPermissions: Permission[];
}

// ✅ Updated with granular shop inventory permissions
const permissionGroups: PermissionGroup[] = [
  {
    tabLabel: '👥 Users',
    viewPermission: 'VIEW_USERS',
    actionPermissions: ['MANAGE_USERS', 'CREATE_USER', 'RESET_USER_PASSWORD'],
  },
  {
    tabLabel: '📄 Invoices & Credit Notes',
    viewPermission: 'VIEW_INVOICES',
    actionPermissions: ['CREATE_CREDIT_NOTE', 'MANAGE_CREDIT_CUSTOMERS', 'DELETE_CUSTOMER', 'RECORD_CREDIT_PAYMENT'],
  },
  {
    tabLabel: '🛒 Shop Retail Items',
    viewPermission: 'VIEW_SHOP',
    actionPermissions: [
      'MANAGE_SHOP_ITEMS',
      'CREATE_SHOP_ITEM',
      'UPDATE_SHOP_ITEM',
      'DELETE_SHOP_ITEM',
      'BULK_UPLOAD_SHOP_ITEMS',
      'ADJUST_STOCK',
      'EDIT_PRICE',
    ],
  },
  {
    tabLabel: '📊 Stock & Inventory Audit',
    viewPermission: 'VIEW_STOCK',
    actionPermissions: ['ADJUST_STOCK'], // Note: ADJUST_STOCK also appears here; you may keep both or remove one.
  },
  {
    tabLabel: '⛽ Pumps & Tanks',
    viewPermission: 'VIEW_PUMPS',
    actionPermissions: [
      'MANAGE_PUMPS',
      'DELETE_PUMP',
      'VIEW_DIP_VARIANCE',
      'REVIEW_DIP_VARIANCE',
      'RESOLVE_DIP_VARIANCE',
    ],
  },
  {
    tabLabel: '🔌 Controllers & Integrations',
    viewPermission: 'VIEW_AUTOMATION',
    actionPermissions: ['MANAGE_CONTROLLERS', 'VIEW_AUTOMATION_LOGS'],
  },
  {
    tabLabel: '🔗 Device Mappings',
    viewPermission: 'VIEW_DEVICE_MAPPINGS',
    actionPermissions: ['MANAGE_DEVICE_MAPPINGS'],
  },
  {
    tabLabel: '🔒 Manager Approvals',
    viewPermission: 'VIEW_APPROVALS',
    actionPermissions: ['MANAGE_APPROVALS'],
  },
  {
    tabLabel: '⚙️ Invoice Headers & Settings',
    viewPermission: 'VIEW_SETTINGS',
    actionPermissions: ['MANAGE_SETTINGS'],
  },
  {
    tabLabel: '📦 Suppliers & OMCs',
    viewPermission: 'VIEW_SUPPLIERS',
    actionPermissions: ['MANAGE_SUPPLIERS', 'DELETE_SUPPLIER', 'RECORD_SUPPLIER_PAYOUT'],
  },
  {
    tabLabel: '💰 Cash Flow & Accounts',
    viewPermission: 'VIEW_CASH_FLOW',
    actionPermissions: ['MANAGE_CASH_FLOW'],
  },
  {
    tabLabel: '⚖️ 3-Way Match Ledger',
    viewPermission: 'VIEW_THREE_WAY_LEDGER',
    actionPermissions: ['MANAGE_THREE_WAY_LEDGER'],
  },
  {
    tabLabel: '📜 Audit Trail & Logs',
    viewPermission: 'VIEW_AUDIT_TRAIL',
    actionPermissions: [],
  },
  {
    tabLabel: '📈 Reports & Analytics',
    viewPermission: 'VIEW_REPORTS',
    actionPermissions: [],
  },
  {
    tabLabel: '📋 Shifts & Clock-In',
    viewPermission: 'VIEW_SHIFT_USERS',
    actionPermissions: [
      'CREATE_SHIFT',
      'EDIT_SHIFT',
      'ASSIGN_SHIFT_USERS',
      'REMOVE_SHIFT_USERS',
      'CLOCK_IN_OTHER_USERS',
    ],
  },
];

// =========================================================
// USER TABLE ROW
// =========================================================

interface UserTableRowProps {
  user: User;
  shifts: ShiftSession[];
  currentUser: User;
  roleOptions: string[];
  onRoleChange: (user: User, newRole: string) => Promise<void>;
  onStatusToggle: (user: User) => Promise<void>;
  onDelete: (user: User) => Promise<void>;
  onResetPin: (user: User) => void;
  onView: (user: User) => void;
  actionLoading: string | null;
}

const UserTableRow = React.memo(
  ({
    user,
    shifts,
    currentUser,
    roleOptions,
    onRoleChange,
    onStatusToggle,
    onDelete,
    onResetPin,
    onView,
    actionLoading,
  }: UserTableRowProps) => {
    const accountStatus = normalizeAccountStatus(user);
    const clockStatus = getClockStatus(user, shifts);
    const activeShift = shifts.find(
      (shift) => shift.staffId === user.id && shift.status === 'Active'
    );
    const isSelf = user.id === currentUser.id;
    const isSuperAdmin = user.role === SUPER_ADMIN_ROLE;
    const isCurrentUserSuperAdmin = currentUser.role === SUPER_ADMIN_ROLE;
    const blockedBySuperAdminRule = isSuperAdmin && !isCurrentUserSuperAdmin;
    const isLoading = actionLoading === user.id;

    const [editingRole, setEditingRole] = useState(false);
    const [tempRole, setTempRole] = useState(user.role);

    useEffect(() => {
      if (!editingRole) {
        setTempRole(user.role);
      }
    }, [user.role, editingRole]);

    const handleRoleSave = async () => {
      const nextRole = tempRole.trim();
      if (!nextRole) {
        toast.error('Please select a valid role.');
        return;
      }
      if (nextRole === user.role) {
        setEditingRole(false);
        return;
      }
      if (blockedBySuperAdminRule) {
        toast.error('Only a Super Admin can modify another Super Admin.');
        setEditingRole(false);
        return;
      }
      if (isSelf && !isCurrentUserSuperAdmin) {
        toast.error('You cannot change your own role.');
        setEditingRole(false);
        return;
      }
      try {
        await onRoleChange(user, nextRole);
        setEditingRole(false);
      } catch {
        setTempRole(user.role);
      }
    };

    const handleRoleCancel = () => {
      setTempRole(user.role);
      setEditingRole(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
      if (e.key === 'Escape') {
        handleRoleCancel();
      }
    };

    return (
      <tr className="border-b border-slate-800/80 hover:bg-slate-950/50">
        {/* USER */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 font-bold text-emerald-300">
              {getInitials(user.name)}
            </div>
            <div>
              <div className="font-semibold text-slate-100">{user.name}</div>
              <div className="text-xs text-slate-400">{user.username || user.email}</div>
              {!!user.permissions?.length && (
                <div className="mt-0.5 text-[10px] text-emerald-400/70">
                  {user.permissions.length} permission
                  {user.permissions.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </td>

        {/* ROLE */}
        <td className="px-4 py-3">
          {editingRole ? (
            <div className="flex items-center gap-2">
              <select
                value={tempRole}
                onChange={(e) => setTempRole(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={
                  isLoading ||
                  blockedBySuperAdminRule ||
                  (isSelf && !isCurrentUserSuperAdmin)
                }
                className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-500 disabled:opacity-50"
                autoFocus
              >
                {roleOptions
                  .filter(
                    (role) => role !== SUPER_ADMIN_ROLE || isCurrentUserSuperAdmin
                  )
                  .map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={handleRoleSave}
                disabled={isLoading}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                aria-label="Save role"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={handleRoleCancel}
                disabled={isLoading}
                className="text-slate-400 hover:text-slate-200 disabled:opacity-50"
                aria-label="Cancel role editing"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-200">{user.role}</span>
              {!blockedBySuperAdminRule && !isSelf && (
                <button
                  type="button"
                  onClick={() => {
                    setTempRole(user.role);
                    setEditingRole(true);
                  }}
                  disabled={isLoading}
                  className="text-slate-400 hover:text-slate-200 disabled:opacity-50"
                  aria-label={`Edit ${user.name}'s role`}
                >
                  <Edit3 className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </td>

        {/* ACCOUNT STATUS */}
        <td className="px-4 py-3">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              accountStatus === 'Active'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : accountStatus === 'Suspended'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}
          >
            {accountStatus}
          </span>
        </td>

        {/* CLOCK STATUS */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${
                clockStatus === 'Clocked In' ? 'bg-emerald-400' : 'bg-slate-500'
              }`}
            />
            <span className="text-xs">
              {clockStatus}
              {activeShift ? ` · ${activeShift.shiftType}` : ''}
            </span>
          </div>
        </td>

        {/* LAST LOGIN */}
        <td className="last-login-cell px-4 py-3 text-xs text-slate-400">
          {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
        </td>

        {/* CREATED */}
        <td className="px-4 py-3 text-xs text-slate-400">
          {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
        </td>

        {/* ACTIONS */}
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {/* VIEW */}
            <button
              type="button"
              onClick={() => onView(user)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 transition-colors hover:bg-slate-700"
            >
              <Eye className="h-3 w-3" />
              View
            </button>

            {/* STATUS TOGGLE */}
            <button
              type="button"
              onClick={() => onStatusToggle(user)}
              disabled={isLoading || blockedBySuperAdminRule || isSelf}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              <Power className="h-3 w-3" />
              {isLoading
                ? '...'
                : accountStatus === 'Active'
                ? 'Deactivate'
                : 'Activate'}
            </button>

            {/* RESET PIN */}
            <button
              type="button"
              onClick={() => onResetPin(user)}
              disabled={isLoading || blockedBySuperAdminRule}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Lock className="h-3 w-3" />
              Reset PIN
            </button>

            {/* DELETE */}
            {!isSelf && (
              <button
                type="button"
                onClick={() => onDelete(user)}
                disabled={isLoading || isSuperAdmin}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }
);

UserTableRow.displayName = 'UserTableRow';

// =========================================================
// MAIN COMPONENT PROPS
// =========================================================

interface UserManagementProps {
  users: User[];
  shifts: ShiftSession[];
  currentUser: User;
  onCreateUser: (payload: any) => Promise<User>;
  onUpdateUser: (userId: string, payload: any) => Promise<User>;
  onResetPassword: (userId: string, newPin: string) => Promise<User>;
  onToggleUserStatus: (userId: string, nextStatus: AccountStatus) => Promise<User>;
  onDeleteUser: (userId: string) => Promise<{ success: boolean }>;
  onUpdatePermissions: (
    userId: string,
    permissions: Permission[]
  ) => Promise<{
    userId: string;
    permissions: Permission[];
  }>;
  onRefreshUser?: () => Promise<void>;
}

// =========================================================
// MAIN COMPONENT
// =========================================================

export const UserManagement: React.FC<UserManagementProps> = ({
  users,
  shifts,
  currentUser,
  onCreateUser,
  onUpdateUser,
  onResetPassword,
  onToggleUserStatus,
  onDeleteUser,
  onUpdatePermissions,
  onRefreshUser,
}) => {
  /* ================= STATE ================= */

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [configuredRoles,setConfiguredRoles]=useState<any[]>([]);
  const [showRoleCreator,setShowRoleCreator]=useState(false);
  const [roleCreatorFromUserForm,setRoleCreatorFromUserForm]=useState(false);
  const [roleDraft,setRoleDraft]=useState<{name:string;description:string;permissions:Permission[]}>({name:'',description:'',permissions:[]});
  const [expandedRoleGroups,setExpandedRoleGroups]=useState<Record<string,boolean>>({});
  const [accountFilter, setAccountFilter] = useState<UserStatus>('All');
  const [clockFilter, setClockFilter] = useState<ClockStatus>('All');
  const [page, setPage] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [resetPinConfirm, setResetPinConfirm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // For collapsible sections in the view modal
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  /* ================= FORM ================= */

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
    setValue,
  } = useForm<UserFormData>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      name: '',
      username: '',
      email: '',
      phone: '',
      role: DEFAULT_ROLE,
      pin: '',
      confirmPin: '',
      department: '',
      jobTitle: '',
      employeeId: '',
      status: 'Active',
      isSuperAdmin: false,
    },
  });

  const isSuperAdminChecked = watch('isSuperAdmin');
  const watchedRole = watch('role');

  /* ================= SUPER ADMIN ROLE ================= */

  useEffect(() => {
    if (isSuperAdminChecked) {
      setValue('role', SUPER_ADMIN_ROLE);
      return;
    }
    if (watchedRole === SUPER_ADMIN_ROLE) {
      setValue('role', DEFAULT_ROLE);
    }
  }, [isSuperAdminChecked, watchedRole, setValue]);

  /* ================= PERMISSIONS ================= */

  const canManageUsers =
    currentUser.role === SUPER_ADMIN_ROLE ||
    currentUser.permissions?.includes('MANAGE_USERS') === true;

  const canManagePermissions =
    currentUser.role === SUPER_ADMIN_ROLE ||
    currentUser.permissions?.includes('MANAGE_USERS') === true;

  const canEditSelectedUsersPermissions = useCallback(
    (targetUser: User) => {
      if (!canManagePermissions) return false;
      if (targetUser.role === SUPER_ADMIN_ROLE && currentUser.role !== SUPER_ADMIN_ROLE)
        return false;
      return true;
    },
    [canManagePermissions, currentUser.role]
  );

  /* ================= MEMOIZED DATA ================= */

  const roleOptions = useMemo(() => getRoleOptions(users,configuredRoles), [users,configuredRoles]);
  const loadRoles=useCallback(async()=>{try{setConfiguredRoles(await api.getRoles());}catch(error){toast.error(error instanceof Error?error.message:'Unable to load roles.');}},[]);
  useEffect(()=>{void loadRoles();},[loadRoles]);
  const openRoleCreator=(fromUserForm:boolean)=>{setRoleCreatorFromUserForm(fromUserForm);setExpandedRoleGroups(Object.fromEntries(permissionGroups.map(group=>[group.tabLabel,true])));setShowRoleCreator(true);};
  const createCustomRole=async()=>{if(roleDraft.name.trim().length<2)return toast.error('Enter a role name.');try{const created=await api.createRole({...roleDraft,name:roleDraft.name.trim(),description:roleDraft.description.trim()});await loadRoles();if(roleCreatorFromUserForm)setValue('role',created.name,{shouldValidate:true});toast.success('Custom role created.');setShowRoleCreator(false);setRoleCreatorFromUserForm(false);setRoleDraft({name:'',description:'',permissions:[]});}catch(error){toast.error(error instanceof Error?error.message:'Unable to create role.');}};

  const allRoleNames = useMemo(() => {
    const roles = new Set<string>();
    users.forEach((user) => {
      if (user.role?.trim()) {
        roles.add(user.role);
      }
    });
    return ['All', ...Array.from(roles).sort()];
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        [user.name, user.username, user.email, user.employeeId].some((value) =>
          String(value || '').toLowerCase().includes(query)
        );
      const matchesRole = roleFilter === 'All' || user.role === roleFilter;
      const matchesAccount =
        accountFilter === 'All' || normalizeAccountStatus(user) === accountFilter;
      const matchesClock =
        clockFilter === 'All' || getClockStatus(user, shifts) === clockFilter;
      return matchesSearch && matchesRole && matchesAccount && matchesClock;
    });
  }, [users, search, roleFilter, accountFilter, clockFilter, shifts]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const paginatedUsers = useMemo(() => {
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, page, totalPages]);

  const summary = useMemo(
    () => ({
      total: users.length,
      active: users.filter((user) => normalizeAccountStatus(user) === 'Active').length,
      clockedIn: users.filter((user) => getClockStatus(user, shifts) === 'Clocked In')
        .length,
      clockedOut: users.filter((user) => getClockStatus(user, shifts) === 'Clocked Out')
        .length,
    }),
    [users, shifts]
  );

  /* ================= EFFECTS ================= */

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, accountFilter, clockFilter]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsCreating(false);
      setSelectedUser(null);
      setResetTarget(null);
      setResetPin('');
      setResetPinConfirm('');
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  /* ================= FORM RESET ================= */

  const resetForm = useCallback(() => {
    reset({
      name: '',
      username: '',
      email: '',
      phone: '',
      role: DEFAULT_ROLE,
      pin: '',
      confirmPin: '',
      department: '',
      jobTitle: '',
      employeeId: '',
      status: 'Active',
      isSuperAdmin: false,
    });
  }, [reset]);

  /* ================= CREATE USER ================= */

  const handleCreateUser = async (data: UserFormData) => {
    if (data.role === SUPER_ADMIN_ROLE && currentUser.role !== SUPER_ADMIN_ROLE) {
      toast.error('Only a Super Admin can create a Super Admin.');
      return;
    }
    try {
      const payload = {
        name: data.name.trim(),
        username: data.username?.trim() || data.email.trim().split('@')[0],
        email: data.email.trim(),
        phone: data.phone?.trim() || '',
        role: data.role.trim(),
        pin: data.pin,
        status: data.status,
        department: data.department?.trim() || '',
        jobTitle: data.jobTitle?.trim() || '',
        employeeId: data.employeeId?.trim() || '',
      };
      const created = await onCreateUser(payload);
      if (!created?.id) throw new Error('Invalid response from server');
      toast.success('User created successfully!');
      resetForm();
      setIsCreating(false);
      if (onRefreshUser) await onRefreshUser();
    } catch (error: any) {
      toast.error(error?.message || 'Unable to create user.');
    }
  };

  /* ================= ROLE CHANGE ================= */

  const handleRoleChange = useCallback(
    async (user: User, nextRole: string) => {
      if (user.role === SUPER_ADMIN_ROLE && currentUser.role !== SUPER_ADMIN_ROLE) {
        toast.error('Only a Super Admin can modify another Super Admin.');
        return;
      }
      if (nextRole === SUPER_ADMIN_ROLE && currentUser.role !== SUPER_ADMIN_ROLE) {
        toast.error('Only a Super Admin can assign the Super Admin role.');
        return;
      }
      setActionLoading(user.id);
      try {
        const updated = await onUpdateUser(user.id, { role: nextRole });
        if (!updated || updated.role !== nextRole)
          throw new Error('Role update failed');
        toast.success(`Role updated to ${nextRole}`);
        if (onRefreshUser) await onRefreshUser();
      } catch (error: any) {
        toast.error(error?.message || 'Failed to update role.');
        throw error;
      } finally {
        setActionLoading(null);
      }
    },
    [currentUser.role, onUpdateUser, onRefreshUser]
  );

  /* ================= STATUS ================= */

  const handleStatusToggle = useCallback(
    async (user: User, confirmed = false) => {
      if (user.id === currentUser.id) {
        toast.error('You cannot change your own account status.');
        return;
      }
      if (user.role === SUPER_ADMIN_ROLE && currentUser.role !== SUPER_ADMIN_ROLE) {
        toast.error('Only a Super Admin can change another Super Admin account.');
        return;
      }
      setActionLoading(user.id);
      try {
        const nextStatus =
          normalizeAccountStatus(user) === 'Active' ? 'Inactive' : 'Active';
        const updated = await onToggleUserStatus(user.id, nextStatus);
        if (!updated || normalizeAccountStatus(updated) !== nextStatus)
          throw new Error('Status update failed');
        toast.success(`Account ${nextStatus.toLowerCase()}`);
        if (onRefreshUser) await onRefreshUser();
      } catch (error: any) {
        toast.error(error?.message || 'Failed to update status.');
      } finally {
        setActionLoading(null);
      }
    },
    [currentUser, onToggleUserStatus, onRefreshUser]
  );

  /* ================= DELETE ================= */

  const handleDeleteUser = useCallback(
    async (user: User, confirmed = false) => {
      if (user.id === currentUser.id) {
        toast.error('You cannot delete your own account.');
        return;
      }
      if (user.role === SUPER_ADMIN_ROLE) {
        toast.error('Super Admin accounts cannot be deleted.');
        return;
      }
      if (!confirmed) { setUserToDelete(user); return; }
      setActionLoading(user.id);
      try {
        const result = await onDeleteUser(user.id);
        if (!result || result.success !== true) throw new Error('Delete failed');
        toast.success(`${user.name} deleted successfully.`);
        if (onRefreshUser) await onRefreshUser();
      } catch (error: any) {
        toast.error(error?.message || 'Failed to delete user.');
      } finally {
        setActionLoading(null);
      }
    },
    [currentUser.id, onDeleteUser, onRefreshUser]
  );

  /* ================= RESET PIN ================= */

  const handleResetPassword = useCallback(async () => {
    if (!resetTarget) return;
    if (resetTarget.role === SUPER_ADMIN_ROLE && currentUser.role !== SUPER_ADMIN_ROLE) {
      toast.error('Only a Super Admin can reset another Super Admin PIN.');
      return;
    }
    if (!PIN_REGEX.test(resetPin)) {
      toast.error('PIN must be 4-6 digits only.');
      return;
    }
    if (resetPin !== resetPinConfirm) {
      toast.error('PINs do not match.');
      return;
    }
    setActionLoading(resetTarget.id);
    try {
      const updated = await onResetPassword(resetTarget.id, resetPin);
      if (!updated || updated.id !== resetTarget.id)
        throw new Error('PIN reset failed');
      toast.success(`PIN reset for ${resetTarget.name}`);
      setResetTarget(null);
      setResetPin('');
      setResetPinConfirm('');
      if (onRefreshUser) await onRefreshUser();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to reset PIN.');
    } finally {
      setActionLoading(null);
    }
  }, [
    resetTarget,
    resetPin,
    resetPinConfirm,
    currentUser.role,
    onResetPassword,
    onRefreshUser,
  ]);

  /* ================= PERMISSIONS ================= */

  const handleSavePermissions = useCallback(async () => {
    if (!selectedUser) return;
    if (selectedUser.role === SUPER_ADMIN_ROLE && currentUser.role !== SUPER_ADMIN_ROLE) {
      toast.error('Only a Super Admin can change another Super Admin permissions.');
      return;
    }
    setActionLoading(selectedUser.id);
    try {
      const result = await onUpdatePermissions(selectedUser.id, selectedPermissions);
      if (!result || result.userId !== selectedUser.id)
        throw new Error('Permission update failed');
      setSelectedPermissions(result.permissions);
      setSelectedUser((prev) =>
        prev ? { ...prev, permissions: result.permissions } : null
      );
      toast.success(`Permissions updated for ${selectedUser.name}!`);
      if (onRefreshUser) await onRefreshUser();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update permissions.');
    } finally {
      setActionLoading(null);
    }
  }, [
    selectedUser,
    selectedPermissions,
    currentUser.role,
    onUpdatePermissions,
    onRefreshUser,
  ]);

  /* ================= VIEW ================= */

  const handleViewUser = useCallback((user: User) => {
    setSelectedUser(user);
    setSelectedPermissions(user.permissions || []);
    // Expand all groups by default
    const expanded: Record<string, boolean> = {};
    permissionGroups.forEach((group) => {
      expanded[group.tabLabel] = true;
    });
    setExpandedGroups(expanded);
  }, []);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  };

  /* ================= REFRESH ================= */

  const handleRefresh = useCallback(async () => {
    if (!onRefreshUser) return;
    setIsRefreshing(true);
    try {
      await onRefreshUser();
      toast.success('User data refreshed!');
    } catch {
      toast.error('Failed to refresh user data.');
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshUser]);

  /* ================= ACCESS GUARD ================= */

  if (!canManageUsers) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-200">
        You do not have permission to view the user management module.
      </div>
    );
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="space-y-6 pb-12">
      {/* HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400">
            USER MANAGEMENT
          </p>
          <h2 className="text-2xl font-black text-slate-100">
            Users
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {onRefreshUser && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Add User
          </button>
          <button type="button" onClick={()=>openRoleCreator(false)} className="fms-btn fms-btn-accent"><ShieldCheck className="h-4 w-4"/>Manage Roles</button>
        </div>
      </div>

      {showRoleCreator && (
        <div className="fms-dialog-overlay z-[70]">
          <div className="fms-dialog max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-white">Create Custom Role</h3>
                <p className="text-xs text-slate-400">Choose access by application tab. Super Admin remains protected.</p>
              </div>
              <button type="button" onClick={()=>setShowRoleCreator(false)}><X className="h-5 w-5"/></button>
            </div>
            <div className="mt-5 grid gap-4">
              <label className="text-xs text-slate-400">Role name
                <input value={roleDraft.name} onChange={e=>setRoleDraft({...roleDraft,name:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white" placeholder="e.g. Shift Supervisor"/>
              </label>
              <label className="text-xs text-slate-400">Description
                <textarea value={roleDraft.description} onChange={e=>setRoleDraft({...roleDraft,description:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white" rows={2}/>
              </label>
              <div>
                <p className="mb-2 text-xs font-bold uppercase text-slate-400">Permissions by tab</p>
                <div className="space-y-3">
                  {permissionGroups.map(group=>{
                    const hasView=roleDraft.permissions.includes(group.viewPermission);
                    const isExpanded=expandedRoleGroups[group.tabLabel]??false;
                    return <div key={group.tabLabel} className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                      <div className="flex items-center gap-2">
                        <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs font-semibold text-slate-200">
                          <input type="checkbox" checked={hasView} onChange={event=>{
                            const permissions=event.target.checked
                              ? [...new Set([...roleDraft.permissions,group.viewPermission])]
                              : roleDraft.permissions.filter(permission=>permission!==group.viewPermission&&!group.actionPermissions.includes(permission));
                            setRoleDraft({...roleDraft,permissions});
                            if(event.target.checked)setExpandedRoleGroups(previous=>({...previous,[group.tabLabel]:true}));
                          }} className="accent-emerald-500"/>
                          <span>{group.tabLabel} — View</span>
                        </label>
                        <button type="button" onClick={()=>setExpandedRoleGroups(previous=>({...previous,[group.tabLabel]:!isExpanded}))} className="text-slate-400 hover:text-white">
                          {isExpanded?<ChevronDown className="h-4 w-4"/>:<ChevronRight className="h-4 w-4"/>}
                        </button>
                      </div>
                      {isExpanded&&hasView&&group.actionPermissions.length>0&&<div className="ml-6 mt-2 grid gap-1.5 border-l-2 border-slate-700 pl-3 sm:grid-cols-2">
                        {group.actionPermissions.filter(permission=>PERMISSIONS.includes(permission)).map(permission=><label key={permission} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900/60 p-2 text-xs text-slate-200 hover:bg-slate-800">
                          <input type="checkbox" checked={roleDraft.permissions.includes(permission)} onChange={event=>setRoleDraft({...roleDraft,permissions:event.target.checked?[...new Set([...roleDraft.permissions,permission])]:roleDraft.permissions.filter(item=>item!==permission)})} className="accent-emerald-500"/>
                          <span>{String(permission).replace(/_/g,' ')}</span>
                        </label>)}
                      </div>}
                    </div>;
                  })}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={()=>setShowRoleCreator(false)} className="rounded-lg bg-slate-800 px-4 py-2">Cancel</button>
              <button type="button" onClick={createCustomRole} className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white">Create Role</button>
            </div>
          </div>
        </div>
      )}

      {/* STATS */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-xs uppercase text-slate-400">Total Users</div>
          <div className="mt-2 text-2xl font-black text-slate-100">{summary.total}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-xs uppercase text-slate-400">Active Users</div>
          <div className="mt-2 text-2xl font-black text-emerald-400">{summary.active}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-xs uppercase text-slate-400">Clocked In</div>
          <div className="mt-2 text-2xl font-black text-sky-400">{summary.clockedIn}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-xs uppercase text-slate-400">Clocked Out</div>
          <div className="mt-2 text-2xl font-black text-slate-200">{summary.clockedOut}</div>
        </div>
      </div>

      {/* FILTERS */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, username or email"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-500/50"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
            >
              {allRoleNames.map((role) => (
                <option key={role} value={role}>
                  {role === 'All' ? 'All Roles' : role}
                </option>
              ))}
            </select>
          </div>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value as UserStatus)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
          >
            <option value="All">All Account Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Suspended">Suspended</option>
          </select>
          <select
            value={clockFilter}
            onChange={(e) => setClockFilter(e.target.value as ClockStatus)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
          >
            <option value="All">All Clock Status</option>
            <option value="Clocked In">Clocked In</option>
            <option value="Clocked Out">Clocked Out</option>
          </select>
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
        <table className="min-w-full text-left text-sm text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-950 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Clock Status</th>
              <th className="last-login-header px-4 py-3">Last Login</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="h-8 w-8 text-slate-600" />
                    <p>No users found matching your filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedUsers.map((user) => (
                <UserTableRow
                  key={user.id}
                  user={user}
                  shifts={shifts}
                  currentUser={currentUser}
                  roleOptions={roleOptions}
                  onRoleChange={handleRoleChange}
                  onStatusToggle={handleStatusToggle}
                  onDelete={handleDeleteUser}
                  onResetPin={setResetTarget}
                  onView={handleViewUser}
                  actionLoading={actionLoading}
                />
              ))
            )}
          </tbody>
        </table>

        {filteredUsers.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
            <div className="text-xs text-slate-400">
              Showing{' '}
              {Math.min((page - 1) * PAGE_SIZE + 1, filteredUsers.length)} to{' '}
              {Math.min(page * PAGE_SIZE, filteredUsers.length)} of{' '}
              {filteredUsers.length}
            </div>
            {totalPages > 1 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="flex items-center px-2 text-xs text-slate-400">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =====================================================
          CREATE USER MODAL
      ===================================================== */}

      {isCreating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsCreating(false);
              resetForm();
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-100">Create User</h3>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  resetForm();
                }}
                className="text-slate-400 transition-colors hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={handleSubmit(handleCreateUser)}
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              {/* NAME */}
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Full Name *
                </label>
                <input
                  {...register('name')}
                  className={`w-full rounded-xl border ${
                    errors.name ? 'border-rose-500' : 'border-slate-700'
                  } bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50`}
                  placeholder="John Doe"
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-rose-400">{errors.name.message}</p>
                )}
              </div>

              {/* USERNAME */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Username
                </label>
                <input
                  {...register('username')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50"
                  placeholder="johndoe"
                />
              </div>

              {/* EMAIL */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Email *
                </label>
                <input
                  type="email"
                  {...register('email')}
                  className={`w-full rounded-xl border ${
                    errors.email ? 'border-rose-500' : 'border-slate-700'
                  } bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50`}
                  placeholder="john@example.com"
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-rose-400">{errors.email.message}</p>
                )}
              </div>

              {/* PHONE */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Phone Number
                </label>
                <input
                  {...register('phone')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50"
                  placeholder="+254 700 000 000"
                />
              </div>

              {/* ROLE */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Role *
                </label>
                <select
                  {...register('role')}
                  disabled={isSuperAdminChecked}
                  className={`w-full rounded-xl border ${
                    errors.role ? 'border-rose-500' : 'border-slate-700'
                  } bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50 disabled:opacity-60`}
                >
                  {roleOptions
                    .filter(
                      (role) =>
                        role !== SUPER_ADMIN_ROLE ||
                        currentUser.role === SUPER_ADMIN_ROLE
                    )
                    .map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                </select>
                {!isSuperAdminChecked && (
                  <button
                    type="button"
                    onClick={() => {
                      openRoleCreator(true);
                    }}
                    className="mt-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                  >
                    + Create and assign a custom role
                  </button>
                )}
                {errors.role && (
                  <p className="mt-1 text-xs text-rose-400">{errors.role.message}</p>
                )}
              </div>

              {/* SUPER ADMIN */}
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    {...register('isSuperAdmin')}
                    disabled={currentUser.role !== SUPER_ADMIN_ROLE}
                    className="h-4 w-4 accent-amber-500"
                  />
                  Grant Super Admin privileges
                </label>
                {currentUser.role !== SUPER_ADMIN_ROLE && (
                  <p className="mt-1 text-[10px] text-slate-400">
                    Only a Super Admin can assign Super Admin privileges.
                  </p>
                )}
              </div>

              {/* STATUS */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Account Status
                </label>
                <select
                  {...register('status')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>

              {/* EMPLOYEE ID */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Employee ID
                </label>
                <input
                  {...register('employeeId')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50"
                  placeholder="EMP-001"
                />
              </div>

              {/* DEPARTMENT */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Department
                </label>
                <input
                  {...register('department')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50"
                  placeholder="Operations"
                />
              </div>

              {/* JOB TITLE */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Job Title
                </label>
                <input
                  {...register('jobTitle')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50"
                  placeholder="Station Attendant"
                />
              </div>

              {/* PIN */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  PIN / Password *
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  {...register('pin')}
                  className={`w-full rounded-xl border ${
                    errors.pin ? 'border-rose-500' : 'border-slate-700'
                  } bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50`}
                  placeholder="4-6 digits"
                />
                {errors.pin && (
                  <p className="mt-1 text-xs text-rose-400">{errors.pin.message}</p>
                )}
              </div>

              {/* CONFIRM PIN */}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Confirm PIN *
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  {...register('confirmPin')}
                  className={`w-full rounded-xl border ${
                    errors.confirmPin ? 'border-rose-500' : 'border-slate-700'
                  } bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500/50`}
                  placeholder="Confirm PIN"
                />
                {errors.confirmPin && (
                  <p className="mt-1 text-xs text-rose-400">{errors.confirmPin.message}</p>
                )}
              </div>

              {/* BUTTONS */}
              <div className="flex justify-end gap-3 pt-2 md:col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    resetForm();
                  }}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-slate-200 transition-colors hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Saving...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================
          VIEW USER MODAL (with hierarchical permissions)
      ===================================================== */}

      {selectedUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedUser(null);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 font-bold text-emerald-300">
                  {getInitials(selectedUser.name)}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-100">{selectedUser.name}</h3>
                  <p className="text-xs text-slate-400">{selectedUser.role}</p>
                  {!!selectedUser.permissions?.length && (
                    <p className="mt-0.5 text-[10px] text-emerald-400/70">
                      {selectedUser.permissions.length} permission
                      {selectedUser.permissions.length !== 1 ? 's' : ''} assigned
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="text-slate-400 transition-colors hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* USER INFORMATION */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoCard
                icon={<Mail className="h-4 w-4 text-emerald-400" />}
                label="Email"
                value={selectedUser.email}
              />
              <InfoCard
                icon={<Phone className="h-4 w-4 text-emerald-400" />}
                label="Phone"
                value={selectedUser.phone || '—'}
              />
              <InfoCard
                icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
                label="Account Status"
                value={normalizeAccountStatus(selectedUser)}
              />
              <InfoCard
                icon={<Clock3 className="h-4 w-4 text-emerald-400" />}
                label="Clock Status"
                value={getClockStatus(selectedUser, shifts)}
              />
              <InfoCard
                icon={<Briefcase className="h-4 w-4 text-emerald-400" />}
                label="Department"
                value={selectedUser.department || '—'}
              />
              <InfoCard
                icon={<Building2 className="h-4 w-4 text-emerald-400" />}
                label="Employee ID"
                value={selectedUser.employeeId || '—'}
              />
              <InfoCard
                icon={<Calendar className="h-4 w-4 text-emerald-400" />}
                label="Created"
                value={
                  selectedUser.createdAt
                    ? new Date(selectedUser.createdAt).toLocaleString()
                    : 'Unknown'
                }
              />
              <InfoCard
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                label="Last Login"
                value={
                  selectedUser.lastLogin
                    ? new Date(selectedUser.lastLogin).toLocaleString()
                    : 'Never'
                }
              />
            </div>

            {/* PERMISSIONS – Hierarchical View + Actions */}
            {canEditSelectedUsersPermissions(selectedUser) && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-slate-400">
                    Delegated System Permissions
                  </div>
                  {actionLoading === selectedUser.id && (
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                  )}
                </div>

                <div className="space-y-3 text-xs text-slate-200">
                  {permissionGroups.map((group) => {
                    // Only show groups that have a valid view permission
                    if (!PERMISSIONS.includes(group.viewPermission)) return null;

                    const hasView = selectedPermissions.includes(group.viewPermission);
                    const isExpanded = expandedGroups[group.tabLabel] ?? false;

                    return (
                      <div
                        key={group.tabLabel}
                        className="rounded-lg border border-slate-700 bg-slate-950/50 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={hasView}
                              disabled={actionLoading === selectedUser.id}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setSelectedPermissions((prev) =>
                                    prev.includes(group.viewPermission)
                                      ? prev
                                      : [...prev, group.viewPermission]
                                  );
                                  setExpandedGroups((prev) => ({
                                    ...prev,
                                    [group.tabLabel]: true,
                                  }));
                                } else {
                                  setSelectedPermissions((prev) =>
                                    prev.filter(
                                      (p) =>
                                        p !== group.viewPermission &&
                                        !group.actionPermissions.includes(p)
                                    )
                                  );
                                }
                              }}
                              className="accent-emerald-500"
                            />
                            <span className="font-semibold">
                              {group.tabLabel} — View
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.tabLabel)}
                            className="ml-2 text-slate-400 hover:text-white"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </div>

                        {isExpanded && hasView && group.actionPermissions.length > 0 && (
                          <div className="ml-6 mt-2 space-y-1.5 border-l-2 border-slate-700 pl-3">
                            {group.actionPermissions
                              .filter((perm) => PERMISSIONS.includes(perm))
                              .map((permission) => (
                                <label
                                  key={permission}
                                  className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900/60 p-1.5 transition-colors hover:bg-slate-800"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedPermissions.includes(permission)}
                                    disabled={actionLoading === selectedUser.id}
                                    onChange={(event) => {
                                      if (event.target.checked) {
                                        setSelectedPermissions((prev) =>
                                          prev.includes(permission)
                                            ? prev
                                            : [...prev, permission]
                                        );
                                      } else {
                                        setSelectedPermissions((prev) =>
                                          prev.filter((item) => item !== permission)
                                        );
                                      }
                                    }}
                                    className="accent-emerald-500"
                                  />
                                  {String(permission).replace(/_/g, ' ')}
                                </label>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={handleSavePermissions}
                    disabled={actionLoading === selectedUser.id}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {actionLoading === selectedUser.id && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    {actionLoading === selectedUser.id ? 'Saving...' : 'Save Permissions'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPermissions(selectedUser.permissions || []);
                      toast.success('Permissions reset to saved state');
                    }}
                    disabled={actionLoading === selectedUser.id}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <AppDialog open={Boolean(userToDelete)} kind="delete" title="Delete user" message={`Delete ${userToDelete?.name || 'this user'}? This action cannot be undone.`} busy={Boolean(userToDelete && actionLoading === userToDelete.id)} onClose={() => setUserToDelete(null)} onConfirm={async () => { if (!userToDelete) return; await handleDeleteUser(userToDelete, true); setUserToDelete(null); }} />

      {/* =====================================================
          RESET PIN MODAL
      ===================================================== */}

      {resetTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setResetTarget(null);
              setResetPin('');
              setResetPinConfirm('');
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-100">
                Reset PIN for {resetTarget.name}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setResetTarget(null);
                  setResetPin('');
                  setResetPinConfirm('');
                }}
                className="text-slate-400 transition-colors hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  New PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={resetPin}
                  onChange={(event) =>
                    setResetPin(event.target.value.replace(/\D/g, ''))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition-colors focus:border-amber-500/50"
                  placeholder="4-6 digits"
                  maxLength={6}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                  Confirm New PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={resetPinConfirm}
                  onChange={(event) =>
                    setResetPinConfirm(event.target.value.replace(/\D/g, ''))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition-colors focus:border-amber-500/50"
                  placeholder="Confirm PIN"
                  maxLength={6}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setResetTarget(null);
                    setResetPin('');
                    setResetPinConfirm('');
                  }}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-slate-200 transition-colors hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={actionLoading === resetTarget.id}
                  className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
                >
                  {actionLoading === resetTarget.id && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {actionLoading === resetTarget.id ? 'Resetting...' : 'Reset PIN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESPONSIVE TABLE STYLING */}
      <style>{`
        @media (max-width: 768px) {
          .last-login-header,
          .last-login-cell {
            display: none;
          }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .last-login-cell {
            max-width: 110px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }
      `}</style>
    </div>
  );
};

/* =========================================================
   INFO CARD
========================================================= */

interface InfoCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}

const InfoCard: React.FC<InfoCardProps> = ({ icon, label, value }) => {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
      <div className="mb-2">{icon}</div>
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className="mt-1 break-all text-sm text-slate-200">{value}</div>
    </div>
  );
};

export default UserManagement;
