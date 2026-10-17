import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Gauge,
  Droplets,
  Truck,
  DollarSign,
  Plus,
  Edit2,
  Fuel,
  Trash2,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Download,
  Printer,
} from 'lucide-react';
import jsPDF from 'jspdf';

import {
  FuelTank,
  FuelPump,
  PumpNozzle,
  FuelProduct,
  FuelDelivery,
  StationSettings,
  User,
  SupplierAccount,
  TaxCode,
  ShiftSession,
  Transaction,
  ITEM_TAX_TYPES,
  TAX_RATE_BY_TYPE,
} from '../../types';
import { FuelDeliveryDocument } from '../../components/FuelDeliveryDocument';
import { printSelectedDocument } from '../../utils/print-document';
import html2canvas from 'html2canvas';

import { usePermissions } from '../../hooks/usePermissions';
import { pts2PriceApi } from '../../services/automationApi';
import { formatTankStockMovement, tankStockPercent } from '../../utils/tank-stock-presentation';

/* =========================================================
   DEITAX FMS.A Dialog Component
========================================================= */

type DTFMSDialogData =
  | {
      type: 'confirm';
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      onConfirm: () => Promise<void> | void;
    }
  | {
      type: 'message';
      title: string;
      message: string;
      variant?: 'success' | 'error' | 'warning' | 'info';
    }
  | null;

interface DTFMSDialogProps {
  dialog: DTFMSDialogData;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isSubmitting?: boolean;
}

const DTFMSDialog: React.FC<DTFMSDialogProps> = ({
  dialog,
  onClose,
  onConfirm,
  isSubmitting = false,
}) => {
  useEffect(() => {
    if (!dialog) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog, isSubmitting, onClose]);

  if (!dialog) return null;

  const isConfirm = dialog.type === 'confirm';

  const getIcon = () => {
    if (dialog.type === 'message') {
      switch (dialog.variant) {
        case 'success':
          return (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
          );
        case 'error':
          return (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10">
              <AlertTriangle className="h-6 w-6 text-rose-400" />
            </div>
          );
        case 'warning':
          return (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
            </div>
          );
        default:
          return (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-500/20 bg-sky-500/10">
              <CheckCircle2 className="h-6 w-6 text-sky-400" />
            </div>
          );
      }
    }

    if (dialog.danger) {
      return (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10">
          <AlertTriangle className="h-6 w-6 text-rose-400" />
        </div>
      );
    }

    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
        <AlertTriangle className="h-6 w-6 text-emerald-400" />
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dt-fms-dialog-title"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
        className="absolute inset-0 h-full w-full cursor-default bg-slate-950/80 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="h-1 w-full bg-emerald-500" />
        <div className="p-6">
          <div className="flex items-start gap-4">
            {getIcon()}
            <div className="min-w-0 flex-1">
              <h3 id="dt-fms-dialog-title" className="text-base font-bold text-slate-100">
                {dialog.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{dialog.message}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!isSubmitting) onClose();
              }}
              disabled={isSubmitting}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-4">
            {isConfirm ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {dialog.cancelLabel || 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={isSubmitting}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    dialog.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Processing...' : dialog.confirmLabel || 'Confirm'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-500"
              >
                Understood
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* =========================================================
   Reusable Modal Shell for Form Dialogs
========================================================= */

const FMSDialogShell = ({
  children,
  maxWidth = 'max-w-md',
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
    <div className="fms-dialog-backdrop absolute inset-0" />
    <div className={`relative z-10 w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl`}>
      <div className="h-1 w-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-600" />
      {children}
    </div>
  </div>
);

const ModalHeader = ({
  title,
  subtitle,
  icon,
  onClose,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onClose: () => void;
}) => (
  <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-5">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
        {icon}
      </div>
      <div>
        <h3 className="text-base font-bold text-white">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
      </div>
    </div>
    <button
      type="button"
      onClick={onClose}
      className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
      aria-label="Close dialog"
    >
      <X className="h-5 w-5" />
    </button>
  </div>
);

const ModalFooter = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-950/40 px-6 py-4">
    {children}
  </div>
);

/* =========================================================
   Main Component
========================================================= */

interface PumpsAndTanksProps {
  shifts: ShiftSession[];
  transactions: Transaction[];
  tanks: FuelTank[];
  pumps: PumpNozzle[];
  pumpUnits: FuelPump[];
  products: FuelProduct[];
  deliveries: FuelDelivery[];
  suppliers: SupplierAccount[];
  currentUser: User;
  stationSettings?: StationSettings | null;

  onRecordDip: (tankId: string, dipLiters: number) => Promise<any>;
  onAddDelivery: (deliveryData: any) => Promise<any>;
  onUpdatePrice: (productId: string, newPrice: number, taxCode?: string, productName?: string) => Promise<any>;

  onDeleteProduct?: (productId: string) => Promise<any>;
  onRegisterTank?: (tankData: any) => Promise<any>;
  onDeleteTank?: (tankId: string) => Promise<any>;
  onRegisterPump?: (pumpData: any) => Promise<any>;
  onDeletePump?: (pumpId: string) => Promise<any>;
  onDeletePumpUnit?: (pumpUnitId: string) => Promise<any>;
}

type NozzleConfig = {
  nozzleNumber: number;
  tankId: string;
  openingMeterReading: number;
  nozzleName: string;
};

export const PumpsAndTanks: React.FC<PumpsAndTanksProps> = ({
  shifts,
  transactions,
  tanks = [],
  pumps = [],
  pumpUnits = [],
  products = [],
  deliveries = [],
  suppliers = [],
  currentUser,
  stationSettings,

  onRecordDip,
  onAddDelivery,
  onUpdatePrice,

  onDeleteProduct,
  onRegisterTank,
  onDeleteTank,
  onRegisterPump,
  onDeletePump,
  onDeletePumpUnit,
}) => {
  /* =========================================================
     SAFE DATA
  ========================================================= */

  const safeTanks = useMemo(() => (Array.isArray(tanks) ? tanks.filter(Boolean) : []), [tanks]);
  const safePumps = useMemo(() => (Array.isArray(pumps) ? pumps.filter(Boolean) : []), [pumps]);
  const safePumpUnits = useMemo(() => (Array.isArray(pumpUnits) ? pumpUnits.filter(Boolean) : []), [pumpUnits]);
  const safeProducts = useMemo(() => (Array.isArray(products) ? products.filter(Boolean) : []), [products]);
  const safeDeliveries = useMemo(() => (Array.isArray(deliveries) ? deliveries.filter(Boolean) : []), [deliveries]);
  const [deliveryPage,setDeliveryPage]=useState(1); const deliveryPageSize=25; const visibleDeliveries=safeDeliveries.slice((deliveryPage-1)*deliveryPageSize,deliveryPage*deliveryPageSize);
  const safeSuppliers = useMemo(() => (Array.isArray(suppliers) ? suppliers.filter(Boolean) : []), [suppliers]);
  const activeShift = useMemo(() => (Array.isArray(shifts) ? shifts : []).filter(shift => shift.status === 'Active').sort((a,b) => Date.parse(b.startTime)-Date.parse(a.startTime))[0], [shifts]);
  const shiftDispensingByNozzle = useMemo(() => {
    const result=new Map<string,{litres:number;amount:number}>();
    if(!activeShift)return result;
    for(const transaction of Array.isArray(transactions)?transactions:[]){
      const nozzleId=String((transaction as any).nozzleId||'');
      if(transaction.shiftId!==activeShift.id||transaction.status==='Voided'||!nozzleId)continue;
      const fuelItems=(transaction.items||[]).filter(item=>String(item.type||'').toUpperCase()==='FUEL');
      const litres=fuelItems.reduce((sum,item)=>sum+(Number(item.qty)||0),0)||Number((transaction as any).quantity||0);
      const current=result.get(nozzleId)||{litres:0,amount:0};
      result.set(nozzleId,{litres:current.litres+litres,amount:current.amount+Number(transaction.totalAmount||0)});
    }
    return result;
  },[activeShift,transactions]);

  /* =========================================================
     PERMISSIONS
  ========================================================= */

  const { hasPermission } = usePermissions(currentUser);
  const canManagePumps = hasPermission('MANAGE_PUMPS');
  const canDeletePump = hasPermission('DELETE_PUMP');
  const canManageTanks = canManagePumps; // tanks are managed with pumps permission

  /* =========================================================
     DIALOG STATE
  ========================================================= */

  const [dialog, setDialog] = useState<DTFMSDialogData>(null);
  const [isDialogSubmitting, setIsDialogSubmitting] = useState(false);

  const showError = (title: string, message: string) => {
    setDialog({ type: 'message', title, message, variant: 'error' });
  };

  const showWarning = (title: string, message: string) => {
    setDialog({ type: 'message', title, message, variant: 'warning' });
  };

  const showSuccess = (title: string, message: string) => {
    setDialog({ type: 'message', title, message, variant: 'success' });
  };

  const closeDialog = () => {
    if (isDialogSubmitting) return;
    setDialog(null);
  };

  const handleDialogConfirm = async () => {
    if (!dialog || dialog.type !== 'confirm') return;

    const activeDialog = dialog;
    setIsDialogSubmitting(true);

    try {
      await activeDialog.onConfirm();
      setDialog((current) => current === activeDialog ? null : current);
    } catch (error: any) {
      console.error(error);
      setDialog({
        type: 'message',
        title: 'Operation Failed',
        message: error?.message || 'The operation could not be completed. Please try again.',
        variant: 'error',
      });
    } finally {
      setIsDialogSubmitting(false);
    }
  };

  /* =========================================================
     MODAL STATE (FORM DIALOGS)
  ========================================================= */

  const [selectedTankForDip, setSelectedTankForDip] = useState<FuelTank | null>(null);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<FuelProduct | null>(null);
  const [showRegisterTankModal, setShowRegisterTankModal] = useState(false);
  const [showRegisterPumpModal, setShowRegisterPumpModal] = useState(false);
  const [editingPumpUnit, setEditingPumpUnit] = useState<FuelPump | null>(null);
  const [viewingPumpUnit, setViewingPumpUnit] = useState<FuelPump | null>(null);
  const [selectedDeliveryReceipt, setSelectedDeliveryReceipt] = useState<FuelDelivery | null>(null);
  const [isGeneratingDeliveryPdf, setIsGeneratingDeliveryPdf] = useState(false);
  const deliveryReceiptRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedDeliveryReceipt) return;
    document.documentElement.dataset.documentPreviewOpen = 'true';
    return () => {
      delete document.documentElement.dataset.documentPreviewOpen;
    };
  }, [selectedDeliveryReceipt]);

  // Separate loading states for each modal
  const [isDipSubmitting, setIsDipSubmitting] = useState(false);
  const [isDeliverySubmitting, setIsDeliverySubmitting] = useState(false);
  const [isPriceSubmitting, setIsPriceSubmitting] = useState(false);
  const [isTankSubmitting, setIsTankSubmitting] = useState(false);
  const [isPumpSubmitting, setIsPumpSubmitting] = useState(false);

  const hasOpenDialog =
    !!selectedTankForDip ||
    showDeliveryModal ||
    !!editingProduct ||
    showRegisterTankModal ||
    showRegisterPumpModal ||
    !!viewingPumpUnit;

  const closeAllFormDialogs = () => {
    if (
      isDipSubmitting ||
      isDeliverySubmitting ||
      isPriceSubmitting ||
      isTankSubmitting ||
      isPumpSubmitting
    )
      return;

    setSelectedTankForDip(null);
    setShowDeliveryModal(false);
    setEditingProduct(null);
    setShowRegisterTankModal(false);
    setShowRegisterPumpModal(false);
    setEditingPumpUnit(null);
    setViewingPumpUnit(null);
  };

  useEffect(() => {
    if (!hasOpenDialog) {
      document.body.style.overflow = '';
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDialogSubmitting) {
        closeAllFormDialogs();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasOpenDialog, isDialogSubmitting]);

  /* =========================================================
     FORM STATE
  ========================================================= */

  const [dipInput, setDipInput] = useState<number>(0);

  const [delTankId, setDelTankId] = useState<string>('');
  const [delSupplierId, setDelSupplierId] = useState<string>('');
  const [delNoteNo, setDelNoteNo] = useState<string>('');
  const [delLiters, setDelLiters] = useState<number>(0);
  const [delCostPerLiter, setDelCostPerLiter] = useState<number>(0);
  const [delDriver, setDelDriver] = useState<string>('');
  const [delTruckPlate, setDelTruckPlate] = useState<string>('');

  const [newTankName, setNewTankName] = useState('');
  const [newTankProduct, setNewTankProduct] = useState('');
  const [newTankCapacity, setNewTankCapacity] = useState<number>(30000);
  const [newTankInitialLevel, setNewTankInitialLevel] = useState<number>(0);
  const [newTankTaxCode, setNewTankTaxCode] = useState<TaxCode>('B');

  const [newPumpName, setNewPumpName] = useState('');
  const [newPumpNumber, setNewPumpNumber] = useState<number>(1);
  const [newPumpTankId, setNewPumpTankId] = useState<string>('');
  const [newPumpMeter, setNewPumpMeter] = useState<number>(0);
  const [newNozzleCount, setNewNozzleCount] = useState<number>(1);
  const [newNozzleConfigs, setNewNozzleConfigs] = useState<NozzleConfig[]>([]);
  const [pumpSearch, setPumpSearch] = useState('');
  const [pumpStatusFilter, setPumpStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');

  const [newPriceInput, setNewPriceInput] = useState<number>(0);
  const [editingProductName, setEditingProductName] = useState('');
  const [editingProductTaxCode, setEditingProductTaxCode] = useState<TaxCode>('B');

  useEffect(() => {
    if (!delTankId && safeTanks.length > 0) {
      setDelTankId(safeTanks[0].id);
    }
  }, [safeTanks, delTankId]);

  useEffect(() => {
    if (safeSuppliers.length === 0) {
      setDelSupplierId('');
      return;
    }

    const exists = safeSuppliers.some((supplier) => supplier.id === delSupplierId);

    if (!exists) {
      setDelSupplierId(safeSuppliers[0].id);
    }
  }, [safeSuppliers, delSupplierId]);

  /* =========================================================
     OPEN DIALOG HELPERS
  ========================================================= */

  const openDipDialog = (tank: FuelTank) => {
    if (isDipSubmitting) return;
    setSelectedTankForDip(tank);
    setDipInput(Number(tank.currentLevelLiters || 0));
  };

  const openDeliveryDialog = () => {
    if (isDeliverySubmitting) return;
    setDelTankId(safeTanks[0]?.id || '');
    setDelSupplierId(safeSuppliers[0]?.id || '');
    setShowDeliveryModal(true);
  };

  const openTankDialog = () => {
    if (!canManageTanks || isTankSubmitting) return;
    setNewTankName('');
    setNewTankProduct('');
    setNewTankCapacity(30000);
    setNewTankInitialLevel(0);
    setNewTankTaxCode('B');
    setShowRegisterTankModal(true);
  };

  const openPumpDialog = () => {
    if (!canManagePumps || isPumpSubmitting) return;
    setNewPumpName('');
    setNewPumpNumber(safePumpUnits.length + 1);
    setNewPumpTankId(safeTanks[0]?.id || '');
    setNewPumpMeter(0);
    setNewNozzleCount(1);
    setNewNozzleConfigs([]);
    setEditingPumpUnit(null);
    setShowRegisterPumpModal(true);
  };

  const openEditPumpDialog = (pumpUnit: FuelPump) => {
    if (!canManagePumps || isPumpSubmitting) return;
    const nozzles = safePumps.filter((nozzle) => nozzle.physicalPumpId === pumpUnit.id).sort((a, b) => (a.nozzleNumber || 0) - (b.nozzleNumber || 0));
    setEditingPumpUnit(pumpUnit);
    setNewPumpName(pumpUnit.pumpName);
    setNewPumpNumber(pumpUnit.pumpNumber);
    setNewPumpTankId(nozzles[0]?.tankId || safeTanks[0]?.id || '');
    setNewPumpMeter(nozzles[0]?.currentMeterReading || 0);
    setNewNozzleCount(Math.max(1, nozzles.length));
    setNewNozzleConfigs(nozzles.map((nozzle) => ({ nozzleNumber: nozzle.nozzleNumber || 1, tankId: nozzle.tankId, openingMeterReading: nozzle.currentMeterReading, nozzleName: nozzle.nozzleName || `Nozzle ${nozzle.nozzleNumber}` })));
    setShowRegisterPumpModal(true);
  };

  /* =========================================================
     SUBMIT DIP
  ========================================================= */

  const handleDipSubmit = async () => {
    if (!selectedTankForDip) return;

    if (dipInput < 0) {
      showWarning('Invalid Dip', 'Dip reading cannot be negative.');
      return;
    }

    setIsDipSubmitting(true);

    try {
      await onRecordDip(selectedTankForDip.id, dipInput);
      setSelectedTankForDip(null);
    } catch (error) {
      console.error(error);
      showError('Error', 'Unable to save the dip reading.');
    } finally {
      setIsDipSubmitting(false);
    }
  };

  /* =========================================================
     SUBMIT DELIVERY
  ========================================================= */

  const handleDeliverySubmit = async () => {
    if (!delTankId) {
      showWarning('Missing Tank', 'Please select a target tank.');
      return;
    }

    if (!delSupplierId) {
      showWarning('Missing Supplier', 'Please register or select a supplier before logging a delivery.');
      return;
    }

    if (!delNoteNo.trim()) {
      showWarning('Missing Note', 'Delivery note number is required.');
      return;
    }

    if (delLiters <= 0) {
      showWarning('Invalid Liters', 'Liters received must be greater than zero.');
      return;
    }

    if (delCostPerLiter <= 0) {
      showWarning('Invalid Cost', 'Cost per liter must be greater than zero.');
      return;
    }

    const selectedSupplier = safeSuppliers.find((supplier) => supplier.id === delSupplierId);

    if (!selectedSupplier) {
      showError('Supplier Missing', 'Selected supplier was not found.');
      return;
    }

    const selectedTank = safeTanks.find((tank) => tank.id === delTankId);

    setIsDeliverySubmitting(true);

    try {
      const result = await onAddDelivery({
        tankId: delTankId,
        tankName: selectedTank?.tankName || 'Unknown Tank',
        supplierId: selectedSupplier.id,
        supplierName: selectedSupplier.name,
        deliveryNoteNo: delNoteNo.trim(),
        litersReceived: delLiters,
        costPerLiter: delCostPerLiter,
        driverName: delDriver.trim() || 'Not Provided',
        truckPlate: delTruckPlate.trim().toUpperCase() || 'Not Provided',
        receivedBy: currentUser?.name,
        userId: currentUser?.id,
        userRole: currentUser?.role,
      });

      setDelNoteNo('');
      setDelLiters(0);
      setDelCostPerLiter(0);
      setDelDriver('');
      setDelTruckPlate('');
      setShowDeliveryModal(false);
      setSelectedDeliveryReceipt((result as any)?.delivery || result);
    } catch (error) {
      console.error(error);
      showError('Delivery Failed', 'Delivery could not be saved. Please try again.');
    } finally {
      setIsDeliverySubmitting(false);
    }
  };

  const printDeliveryReceipt = () => {
    if (deliveryReceiptRef.current) printSelectedDocument(deliveryReceiptRef.current, { pageSize: '80mm auto' });
  };

  const downloadDeliveryReceipt = async () => {
    if (!deliveryReceiptRef.current || !selectedDeliveryReceipt) return;
    setIsGeneratingDeliveryPdf(true);
    try {
      const canvas = await html2canvas(deliveryReceiptRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const width = 80;
      const height = Math.max((canvas.height * width) / canvas.width, 80);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, height], compress: true });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height, undefined, 'FAST');
      pdf.save(`${String(selectedDeliveryReceipt.deliveryNoteNo || selectedDeliveryReceipt.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'fuel-delivery'}-receipt.pdf`);
    } finally {
      setIsGeneratingDeliveryPdf(false);
    }
  };

  /* =========================================================
     UPDATE PRODUCT PRICE
  ========================================================= */

  const handlePriceSubmit = async () => {
    if (!editingProduct) return;

    if (!editingProductName.trim()) {
      showWarning('Missing Name', 'Fuel name is required.');
      return;
    }

    if (newPriceInput <= 0) {
      showWarning('Invalid Price', 'Retail price must be greater than zero.');
      return;
    }

    setIsPriceSubmitting(true);

    try {
      await onUpdatePrice(editingProduct.id, newPriceInput, editingProductTaxCode, editingProductName.trim());
      const productId = editingProduct.id;
      setEditingProduct(null);
      setEditingProductName('');
      setEditingProductTaxCode('B');
      try {
        const preview = await pts2PriceApi.preview(productId, newPriceInput);
        setDialog({
          type: 'confirm',
          title: 'Confirm Live PTS-2 Price Write',
          message: `${preview.productName} is mapped to PTS-2 fuel grade ${preview.fuelGradeId} on ${preview.controllerName}. Live controller price: KES ${preview.currentPts2Price.toFixed(2)}/L. Approved FMS price: KES ${preview.intendedPrice.toFixed(2)}/L. ${preview.preservedFuelGrades} other fuel grade(s) will be preserved exactly. Continue with this one live controller write?`,
          confirmLabel: 'Confirm & Sync to PTS-2',
          cancelLabel: 'Keep FMS Price Only',
          danger: true,
          onConfirm: async () => {
            const result = await pts2PriceApi.confirm(preview.confirmationToken);
            showSuccess('PTS-2 Price Synchronized', `${preview.productName} was verified at KES ${Number(result.readBackValue).toFixed(2)}/L on ${preview.controllerName}.`);
          },
        });
      } catch (syncError: any) {
        if (syncError?.code === 'PTS2_PRODUCT_NOT_MAPPED') {
          showSuccess('FMS Price Saved', 'The price was saved in DEITAX FMS.A. This product has no active PTS-2 fuel-grade mapping, so no controller write was attempted.');
        } else {
          showWarning('FMS Price Saved — PTS-2 Not Changed', `${syncError?.message || 'The live PTS-2 price could not be read.'} No controller write was attempted.`);
        }
      }
    } catch (error) {
      console.error(error);
      showError('Update Failed', error instanceof Error ? error.message : 'Unable to update the fuel product.');
    } finally {
      setIsPriceSubmitting(false);
    }
  };

  /* =========================================================
     REGISTER TANK
  ========================================================= */

  const handleRegisterTankSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canManageTanks) {
      showWarning('Permission Restricted', 'Only users with MANAGE_PUMPS permission can register tanks.');
      return;
    }

    if (!onRegisterTank) return;

    if (!newTankName.trim()) {
      showWarning('Missing Name', 'Tank name is required.');
      return;
    }

    if (!newTankProduct.trim()) {
      showWarning('Missing Product', 'Fuel product name is required.');
      return;
    }

    if (newTankCapacity <= 0) {
      showWarning('Invalid Capacity', 'Tank capacity must be greater than zero.');
      return;
    }

    if (newTankInitialLevel < 0) {
      showWarning('Invalid Level', 'Initial fuel level cannot be negative.');
      return;
    }

    if (newTankInitialLevel > newTankCapacity) {
      showWarning('Invalid Level', 'Initial fuel level cannot exceed the tank capacity.');
      return;
    }

    const normalizedProduct = newTankProduct.trim().toLowerCase();
    const matchingProduct = safeProducts.find((product) => {
      const name = String(product.name || '').toLowerCase();
      const code = String(product.code || '').toLowerCase();
      return name === normalizedProduct || code === normalizedProduct;
    });

    setIsTankSubmitting(true);

    try {
      await onRegisterTank({
        tankName: newTankName.trim(),
        fuelProductId: matchingProduct?.id || '',
        fuelName: newTankProduct.trim(),
        taxCode: newTankTaxCode,
        capacityLiters: newTankCapacity,
        currentLevelLiters: newTankInitialLevel,
        reorderLevelLiters: 5000,
      });

      setNewTankName('');
      setNewTankProduct('');
      setNewTankCapacity(30000);
      setNewTankInitialLevel(0);
      setNewTankTaxCode('B');
      setShowRegisterTankModal(false);
    } catch (error) {
      console.error(error);
      showError('Registration Failed', 'Unable to register the tank.');
    } finally {
      setIsTankSubmitting(false);
    }
  };

  /* =========================================================
     REGISTER PUMP
  ========================================================= */

  const handleRegisterPumpSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canManagePumps) {
      showWarning('Permission Restricted', 'Only users with MANAGE_PUMPS permission can register pumps.');
      return;
    }

    if (!onRegisterPump) return;

    if (!newPumpName.trim()) {
      showWarning('Missing Name', 'Pump name is required.');
      return;
    }

    if (!newPumpTankId) {
      showWarning('Missing Tank', 'Please select a tank before registering the pump.');
      return;
    }

    if (newNozzleCount < 1) {
      showWarning('Invalid Nozzles', 'A pump must have at least one nozzle.');
      return;
    }

    const nozzleConfigs = Array.from({ length: newNozzleCount }, (_, index) =>
      newNozzleConfigs[index] || {
        tankId: newPumpTankId,
        nozzleNumber: index + 1,
        openingMeterReading: newPumpMeter,
        nozzleName: `Nozzle ${index + 1}`,
      }
    );

    setIsPumpSubmitting(true);

    try {
      const duplicateNozzle = nozzleConfigs.map((config) => Number(config.nozzleNumber)).find((number, index, all) => !Number.isInteger(number) || number <= 0 || all.indexOf(number) !== index);
      if (duplicateNozzle !== undefined) {
        showWarning('Invalid Nozzles', `Nozzle ${duplicateNozzle} is duplicated or invalid. Each nozzle number must be unique for this pump.`);
        return;
      }
      await onRegisterPump({
        pumpName: newPumpName.trim(),
        pumpNumber: newPumpNumber,
        tankId: newPumpTankId,
        openingMeterReading: newPumpMeter,
        nozzleConfigs,
      });

      setNewPumpName('');
      setNewPumpNumber(safePumpUnits.length + 1);
      setNewPumpTankId(safeTanks[0]?.id || '');
      setNewPumpMeter(0);
      setNewNozzleCount(1);
      setNewNozzleConfigs([]);
      setShowRegisterPumpModal(false);
      setEditingPumpUnit(null);
    } catch (error) {
      console.error(error);
      showError('Registration Failed', 'Unable to register the pump.');
    } finally {
      setIsPumpSubmitting(false);
    }
  };

  /* =========================================================
     DELETE ACTIONS
  ========================================================= */

  const handleDeleteProductClick = (product: FuelProduct) => {
    if (!canManagePumps) {
      showWarning('Permission Restricted', 'Only users with MANAGE_PUMPS permission can delete fuel products.');
      return;
    }

    if (!onDeleteProduct) {
      showError('Action Unavailable', 'Product deletion is not currently configured.');
      return;
    }

    setDialog({
      type: 'confirm',
      title: 'Delete Fuel Product?',
      message: `You are about to delete "${product.name}". This may affect linked tanks, pumps, and inventory records. Historical transactions should remain preserved.`,
      confirmLabel: 'Delete Product',
      cancelLabel: 'Keep Product',
      danger: true,
      onConfirm: async () => {
        await onDeleteProduct(product.id);
      },
    });
  };

  const handleDeleteTankClick = (tank: FuelTank) => {
    if (!canManageTanks) {
      showWarning('Permission Restricted', 'Only users with MANAGE_PUMPS permission can delete tanks.');
      return;
    }

    if (!onDeleteTank) {
      showError('Action Unavailable', 'Tank deletion is not currently configured.');
      return;
    }

    setDialog({
      type: 'confirm',
      title: 'Delete Underground Tank?',
      message: `You are about to delete "${tank.tankName}". Linked pump/nozzle operational records may be removed from active configuration. This action cannot be undone.`,
      confirmLabel: 'Delete Tank',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: async () => {
        await onDeleteTank(tank.id);
      },
    });
  };

  const handleDeletePumpClick = (pump: PumpNozzle) => {
    if (!canDeletePump) {
      showWarning('Permission Restricted', 'Only users with DELETE_PUMP permission can delete pump nozzles.');
      return;
    }

    if (!onDeletePump) {
      showError('Action Unavailable', 'Pump nozzle deletion is not currently configured.');
      return;
    }

    setDialog({
      type: 'confirm',
      title: 'Delete Pump Nozzle?',
      message: `Delete "${pump.nozzleName || 'this nozzle'}" from "${pump.pumpName}"? Historical transactions and receipts should remain preserved.`,
      confirmLabel: 'Delete Nozzle',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: async () => {
        await onDeletePump(pump.id);
      },
    });
  };

  const handleDeletePumpUnitClick = (pumpUnit: FuelPump) => {
    if (!canDeletePump) {
      showWarning('Permission Restricted', 'Only users with DELETE_PUMP permission can delete physical pumps.');
      return;
    }

    if (!onDeletePumpUnit) {
      showError('Action Unavailable', 'Physical pump deletion is not currently configured.');
      return;
    }

    const nozzleCount = safePumps.filter((nozzle) => nozzle.physicalPumpId === pumpUnit.id).length;

    setDialog({
      type: 'confirm',
      title: 'Delete Physical Pump?',
      message: `You are about to delete "${pumpUnit.pumpName}" and remove ${nozzleCount} configured nozzle(s) from active operations. Historical transactions and receipts should remain preserved.`,
      confirmLabel: 'Delete Pump',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: async () => {
        await onDeletePumpUnit(pumpUnit.id);
      },
    });
  };

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <>
      <div className="space-y-6 pb-12">
        {/* ===== Header ===== */}
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl sm:flex-row sm:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-slate-100">
              <Gauge className="h-6 w-6 text-emerald-400" />
              Pump & Tank Operational Management
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Manage underground tanks, physical pumps, independently metered nozzles and fuel deliveries.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canManageTanks && (
              <button
                type="button"
                onClick={openTankDialog}
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
              >
                <Plus className="h-4 w-4 text-emerald-400" />
                Register Tank
              </button>
            )}
            {canManagePumps && (
              <button
                type="button"
                onClick={openPumpDialog}
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
              >
                <Plus className="h-4 w-4 text-emerald-400" />
                Register Pump
              </button>
            )}

            <button
              type="button"
              onClick={openDeliveryDialog}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500"
            >
              <Truck className="h-4 w-4" />
              Log Fuel Delivery
            </button>
          </div>
        </div>

        {/* ===== Fuel Products ===== */}
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-100">
              <DollarSign className="h-5 w-5 text-emerald-400" />
              Active Fuel Retail Prices
            </h3>
            <span className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-medium text-slate-400">
              DEITAX FMS.A Fuel Pricing
            </span>
          </div>

          {safeProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-8 text-center">
              <Fuel className="mx-auto mb-3 h-8 w-8 text-slate-600" />
              <p className="text-sm font-semibold text-slate-400">No fuel products configured</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {safeProducts.map((product) => {
                const margin = Number(product.pricePerLiter || 0) - Number(product.costPerLiter || 0);
                const marginPercentage = Number(product.pricePerLiter || 0) > 0 ? (margin / Number(product.pricePerLiter)) * 100 : 0;
                const taxCode = (product.taxCode ??
                  (product.taxRate === 0 ? 'A' : product.taxRate === 0.08 ? 'E' : 'B')) as TaxCode;

                return (
                  <div key={product.id} className="rounded-xl border border-slate-800 bg-slate-950 p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-white">{product.name}</h4>
                        <p className="mt-1 text-[10px] text-slate-500">Tax Group {taxCode}</p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProduct(product);
                            setNewPriceInput(Number(product.pricePerLiter));
                            setEditingProductName(product.name);
                            setEditingProductTaxCode(taxCode);
                          }}
                          className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-emerald-400 transition hover:bg-slate-700"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        {canManagePumps && onDeleteProduct && (
                          <button
                            type="button"
                            onClick={() => handleDeleteProductClick(product)}
                            className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-rose-400 transition hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between text-slate-400">
                        <span>Cost Price</span>
                        <span>KES {Number(product.costPerLiter || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-black text-emerald-400">
                        <span>Retail Price</span>
                        <span>KES {Number(product.pricePerLiter || 0).toFixed(2)}</span>
                      </div>
                      <div className="border-t border-slate-800 pt-2 text-amber-400">
                        <div className="flex justify-between">
                          <span>Margin / L</span>
                          <span>KES {margin.toFixed(2)}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">Margin {marginPercentage.toFixed(1)}%</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ===== Tanks ===== */}
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-100">
              <Droplets className="h-5 w-5 text-emerald-400" />
              Underground Fuel Tanks
            </h3>
            <span className="text-xs text-slate-500">
              {safeTanks.length} tank{safeTanks.length === 1 ? '' : 's'}
            </span>
          </div>

          {safeTanks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center text-sm text-slate-500">
              No underground tanks registered.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {safeTanks.map((tank) => {
                const rawCapacity = Number(tank.capacityLiters);
                const rawLevel = Number(tank.currentLevelLiters);
                const capacity = Number.isFinite(rawCapacity) ? rawCapacity : 0;
                const level = Number.isFinite(rawLevel) ? rawLevel : 0;
                const percentage = tankStockPercent(level, capacity);

                return (
                  <div key={tank.id} className="space-y-4 rounded-xl border border-slate-800 bg-slate-950 p-5">
                    <div>
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-white">{tank.tankName}</h4>
                          <p className="mt-1 text-xs text-slate-500">{tank.fuelName}</p>
                        </div>
                        {canManageTanks && (
                          <button
                            type="button"
                            onClick={() => handleDeleteTankClick(tank)}
                            className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-rose-400 hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between text-slate-400">
                        <span>Capacity</span>
                        <span>{capacity.toLocaleString()} L</span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-300">Current FMS Tank Balance</span>
                        <span className="text-emerald-400">{level.toLocaleString()} L</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>FMS stock level</span>
                        <span>{percentage.toFixed(1)}% of capacity</span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full border border-slate-800 bg-slate-900">
                        <div
                          className={percentage < 30 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>

                    <div className="border-t border-slate-800 pt-3 text-[10px] text-slate-500">
                      <span>Latest stock movement: </span>
                      <span className="font-medium text-slate-300">{formatTankStockMovement(tank.latestStockMovement)}</span>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-800 pt-3">
                      <span className="text-[10px] text-slate-500">Latest manual dip: {tank.manualDipVolume==null?'—':tank.manualDipVolume.toLocaleString()+' L'}</span>
                      <button
                        type="button"
                        onClick={() => openDipDialog(tank)}
                        className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-emerald-400 hover:bg-slate-700"
                      >
                        Enter Dip
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ===== Physical Pumps ===== */}
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-100">
              <Fuel className="h-5 w-5 text-emerald-400" />
              Physical Pump & Nozzle Architecture ({safePumpUnits.length})
            </h3>
            {canManagePumps && <button type="button" onClick={openPumpDialog} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">+ Add Physical Pump</button>}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={pumpSearch} onChange={(event) => setPumpSearch(event.target.value)} placeholder="Search pumps…" className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500" />
            <select value={pumpStatusFilter} onChange={(event) => setPumpStatusFilter(event.target.value as any)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"><option>All</option><option>Active</option><option>Inactive</option></select>
          </div>

          {safePumpUnits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center text-sm text-slate-500">
              No physical pumps registered.
            </div>
          ) : (
            <div className="space-y-3">
              {safePumpUnits.filter((pumpUnit) => {
                const matchesSearch = `${pumpUnit.pumpName} ${pumpUnit.pumpNumber} ${pumpUnit.id}`.toLowerCase().includes(pumpSearch.trim().toLowerCase());
                const matchesStatus = pumpStatusFilter === 'All' || pumpUnit.status === pumpStatusFilter;
                return matchesSearch && matchesStatus;
              }).map((pumpUnit) => {
                const nozzles = safePumps.filter((nozzle) => nozzle.physicalPumpId === pumpUnit.id);

                return (
                  <section key={pumpUnit.id} className="overflow-hidden rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between bg-slate-950 px-5 py-4">
                      <div>
                        <h4 className="font-bold text-white">{pumpUnit.pumpName}</h4>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Pump {pumpUnit.pumpNumber} · {nozzles.length} nozzle{nozzles.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-400">
                          {pumpUnit.status}
                        </span>
                        <button type="button" onClick={() => setViewingPumpUnit(pumpUnit)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-slate-700">View Pump</button>
                        {canManagePumps && <button type="button" onClick={() => openEditPumpDialog(pumpUnit)} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/20">Configure</button>}
                        {canDeletePump && (
                          <button
                            type="button"
                            onClick={() => handleDeletePumpUnitClick(pumpUnit)}
                            className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-rose-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {nozzles.map((nozzle) => {
                      const tank = safeTanks.find((item) => item.id === nozzle.tankId);
                      const captured=shiftDispensingByNozzle.get(nozzle.id);

                      return (
                        <div
                          key={nozzle.id}
                          className="grid gap-3 border-t border-slate-800 px-5 py-4 text-xs sm:grid-cols-[1.2fr_1fr_1fr_1fr_auto] sm:items-center"
                        >
                          <div>
                            <div className="font-bold text-slate-200">{nozzle.nozzleName || 'Unnamed Nozzle'}</div>
                            <div className="mt-1 text-[10px] text-slate-500">{nozzle.fuelName}</div>
                          </div>
                          <div className="text-slate-400">
                            Tank: <span className="text-slate-200">{tank?.tankName || 'Unknown'}</span>
                          </div>
                          <div className="font-mono text-slate-400">
                            Meter: <span className="text-emerald-400">{Number(nozzle.currentMeterReading).toFixed(1)} L</span>
                          </div>
                          <div className="font-mono text-slate-400">
                            Shift · {nozzle.fuelName}: <span className="text-amber-400">+{(captured?.litres||0).toFixed(3)} L · KES {(captured?.amount||0).toLocaleString('en-KE',{minimumFractionDigits:2})}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-emerald-400">{nozzle.status}</span>
                            {canDeletePump && (
                              <button
                                type="button"
                                onClick={() => handleDeletePumpClick(nozzle)}
                                className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-1.5 text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
              {safePumpUnits.length > 0 && safePumpUnits.filter((pumpUnit) => `${pumpUnit.pumpName} ${pumpUnit.pumpNumber} ${pumpUnit.id}`.toLowerCase().includes(pumpSearch.trim().toLowerCase()) && (pumpStatusFilter === 'All' || pumpUnit.status === pumpStatusFilter)).length === 0 && <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-xs text-slate-500">No pumps match the selected search or status filter.</div>}
            </div>
          )}
        </div>

        {/* ===== Delivery Log ===== */}
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-100">
              <Truck className="h-5 w-5 text-emerald-400" />
              Fuel Tanker Deliveries
            </h3>
          </div>

          {safeDeliveries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center text-sm text-slate-500">
              No fuel deliveries have been recorded.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Delivery Note</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">Tank</th>
                    <th className="px-4 py-3 text-right">Liters</th>
                    <th className="px-4 py-3 text-right">Total Cost</th>
                    <th className="px-4 py-3 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {visibleDeliveries.map((delivery) => {
                    const resolvedTankName =
                      delivery.tankName ||
                      safeTanks.find((t) => t.id === delivery.tankId)?.tankName ||
                      '—';

                    return (
                      <tr key={delivery.id} className="hover:bg-slate-950/50">
                        <td className="px-4 py-3 font-bold text-emerald-400">{delivery.deliveryNoteNo}</td>
                        <td className="px-4 py-3 text-slate-400">{new Date(delivery.timestamp).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-slate-200">{delivery.supplierName}</td>
                        <td className="px-4 py-3 text-slate-300">{resolvedTankName}</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-400">
                          +{Number(delivery.litersReceived || 0).toLocaleString()} L
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-white">
                          KES {Number(delivery.totalCost || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedDeliveryReceipt(delivery)}
                            className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-emerald-400 transition hover:bg-slate-700"
                            aria-label={`Preview receipt for ${delivery.deliveryNoteNo || 'fuel delivery'}`}
                            title="Preview and download delivery receipt"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table><div className="flex items-center justify-between border-t border-slate-800 p-3 text-xs text-slate-400"><span>Page {deliveryPage} of {Math.max(1,Math.ceil(safeDeliveries.length/deliveryPageSize))}</span><div className="flex gap-2"><button disabled={deliveryPage<=1} onClick={()=>setDeliveryPage(v=>v-1)} className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40">Previous</button><button disabled={deliveryPage>=Math.ceil(safeDeliveries.length/deliveryPageSize)} onClick={()=>setDeliveryPage(v=>v+1)} className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40">Next</button></div></div>
            </div>
          )}
        </div>

        {/* ===== Modals (Form Dialogs) ===== */}

        {/* Dip Modal */}
        {selectedTankForDip && (
          <FMSDialogShell>
            <ModalHeader
              title="Set Initial Tank Stock"
              subtitle={`Tank: ${selectedTankForDip.tankName} · administrator setup`}
              icon={<Droplets className="h-5 w-5" />}
              onClose={() => setSelectedTankForDip(null)}
            />
            <div className="space-y-5 p-6">
              <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Current FMS Tank Balance</div>
                <div className="mt-1 text-2xl font-black text-emerald-400">
                  {Number(selectedTankForDip.currentLevelLiters || 0).toLocaleString()} L
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-slate-400">Manual Dip Volume (L) — enter an independently measured volume</label>
                <input
                  type="number"
                  min="0"
                  autoFocus
                  value={dipInput}
                  onChange={(event) => setDipInput(Number(event.target.value) || 0)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-xl font-bold text-emerald-400 outline-none transition focus:border-emerald-500"
                />
              </div>
            </div>
            <ModalFooter>
              <button
                type="button"
                onClick={() => setSelectedTankForDip(null)}
                disabled={isDipSubmitting}
                className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDipSubmit}
                disabled={isDipSubmitting}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isDipSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Set Initial Stock
              </button>
            </ModalFooter>
          </FMSDialogShell>
        )}

        {/* Delivery Modal */}
        {showDeliveryModal && (
          <FMSDialogShell maxWidth="max-w-2xl">
            <ModalHeader
              title="Log Fuel Tanker Delivery"
              subtitle="Record incoming fuel stock and supplier delivery details."
              icon={<Truck className="h-5 w-5" />}
              onClose={() => setShowDeliveryModal(false)}
            />
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs text-slate-400">Target Tank</label>
                <select
                  value={delTankId}
                  onChange={(event) => setDelTankId(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500"
                >
                  {safeTanks.map((tank) => (
                    <option key={tank.id} value={tank.id}>
                      {tank.tankName} — {tank.fuelName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-400">Registered Supplier</label>
                <select
                  value={delSupplierId}
                  onChange={(event) => setDelSupplierId(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500"
                >
                  {safeSuppliers.length === 0 ? (
                    <option value="">No suppliers registered</option>
                  ) : (
                    safeSuppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-400">Delivery Note Number</label>
                <input
                  type="text"
                  value={delNoteNo}
                  onChange={(event) => setDelNoteNo(event.target.value)}
                  placeholder="DN-000001"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-400">Liters Received</label>
                <input
                  type="number"
                  min="0"
                  value={delLiters}
                  onChange={(event) => setDelLiters(Number(event.target.value) || 0)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-sm text-emerald-400 outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-400">Cost Per Liter (KES)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={delCostPerLiter}
                  onChange={(event) => setDelCostPerLiter(Number(event.target.value) || 0)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-sm text-white outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-400">Truck Registration</label>
                <input
                  type="text"
                  value={delTruckPlate}
                  onChange={(event) => setDelTruckPlate(event.target.value)}
                  placeholder="KXX 000X"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm uppercase text-white outline-none focus:border-emerald-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-xs text-slate-400">Driver Name</label>
                <input
                  type="text"
                  value={delDriver}
                  onChange={(event) => setDelDriver(event.target.value)}
                  placeholder="Driver full name"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <ModalFooter>
              <button
                type="button"
                onClick={() => setShowDeliveryModal(false)}
                disabled={isDeliverySubmitting}
                className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeliverySubmit}
                disabled={isDeliverySubmitting}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isDeliverySubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit Delivery
              </button>
            </ModalFooter>
          </FMSDialogShell>
        )}

        {/* Price Edit Modal */}
        {editingProduct && (
          <FMSDialogShell>
            <ModalHeader
              title="Update Fuel Price"
              subtitle="Update the retail price and tax group."
              icon={<DollarSign className="h-5 w-5" />}
              onClose={() => setEditingProduct(null)}
            />
            <div className="space-y-5 p-6">
              <div>
                <label className="mb-2 block text-xs text-slate-400">Fuel Name</label>
                <input
                  type="text"
                  value={editingProductName}
                  onChange={(event) => setEditingProductName(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-400">Retail Price Per Liter (KES)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newPriceInput}
                  onChange={(event) => setNewPriceInput(Number(event.target.value) || 0)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-xl font-bold text-emerald-400 outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-400">Tax Group</label>
                <select
                  value={editingProductTaxCode}
                  onChange={(event) => setEditingProductTaxCode(event.target.value as TaxCode)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                >
                  {ITEM_TAX_TYPES.map((taxCode) => (
                    <option key={taxCode} value={taxCode}>
                      {taxCode} — {TAX_RATE_BY_TYPE[taxCode] * 100}%
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ModalFooter>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                disabled={isPriceSubmitting}
                className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePriceSubmit}
                disabled={isPriceSubmitting}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isPriceSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Changes
              </button>
            </ModalFooter>
          </FMSDialogShell>
        )}

        {/* Register Tank Modal */}
        {showRegisterTankModal && (
          <FMSDialogShell>
            <ModalHeader
              title="Register Underground Tank"
              subtitle="Add a new fuel storage tank to the station."
              icon={<Droplets className="h-5 w-5" />}
              onClose={() => setShowRegisterTankModal(false)}
            />
            <form onSubmit={handleRegisterTankSubmit}>
              <div className="space-y-5 p-6">
                <div>
                  <label className="mb-2 block text-xs text-slate-400">Tank Name *</label>
                  <input
                    required
                    type="text"
                    value={newTankName}
                    onChange={(event) => setNewTankName(event.target.value)}
                    placeholder="Tank 01"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs text-slate-400">Fuel Product *</label>
                  <input
                    required
                    type="text"
                    value={newTankProduct}
                    onChange={(event) => setNewTankProduct(event.target.value)}
                    placeholder="Super Petrol"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs text-slate-400">Fuel Tax Group</label>
                  <select
                    value={newTankTaxCode}
                    onChange={(event) => setNewTankTaxCode(event.target.value as TaxCode)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                  >
                    {ITEM_TAX_TYPES.map((taxCode) => (
                      <option key={taxCode} value={taxCode}>
                        {taxCode} — {TAX_RATE_BY_TYPE[taxCode] * 100}%
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-xs text-slate-400">Capacity (L)</label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={newTankCapacity}
                      onChange={(event) => setNewTankCapacity(Number(event.target.value) || 0)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-emerald-400 outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs text-slate-400">Initial Level (L)</label>
                    <input
                      required
                      type="number"
                      min="0"
                      value={newTankInitialLevel}
                      onChange={(event) => setNewTankInitialLevel(Number(event.target.value) || 0)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-white outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
              <ModalFooter>
                <button
                  type="button"
                  onClick={() => setShowRegisterTankModal(false)}
                  disabled={isTankSubmitting}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTankSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isTankSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Register Tank
                </button>
              </ModalFooter>
            </form>
          </FMSDialogShell>
        )}

        {/* Register Pump Modal */}
        {showRegisterPumpModal && (
          <FMSDialogShell maxWidth="max-w-2xl">
            <ModalHeader
              title={editingPumpUnit ? `Configure ${editingPumpUnit.pumpName}` : 'Register Physical Pump'}
              subtitle="Configure the pump and independently metered nozzles."
              icon={<Gauge className="h-5 w-5" />}
              onClose={() => setShowRegisterPumpModal(false)}
            />
            <form onSubmit={handleRegisterPumpSubmit}>
              <div className="space-y-5 p-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs text-slate-400">Pump Name *</label>
                    <input
                      required
                      type="text"
                      value={newPumpName}
                      onChange={(event) => setNewPumpName(event.target.value)}
                      placeholder="Pump 01"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs text-slate-400">Pump Number</label>
                    <input
                      type="number"
                      min="1"
                      value={newPumpNumber}
                      onChange={(event) => setNewPumpNumber(Number(event.target.value) || 1)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-white outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs text-slate-400">Default Tank</label>
                  <select
                    value={newPumpTankId}
                    onChange={(event) => setNewPumpTankId(event.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                  >
                    {safeTanks.map((tank) => (
                      <option key={tank.id} value={tank.id}>
                        {tank.tankName} — {tank.fuelName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs text-slate-400">Number of Nozzles</label>
                    <input
                      type="number"
                      min="1"
                      value={newNozzleCount}
                      onChange={(event) => setNewNozzleCount(Math.max(1, Number(event.target.value) || 1))}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-white outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs text-slate-400">Default Cumulative Meter Reading</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newPumpMeter}
                      onChange={(event) => setNewPumpMeter(Number(event.target.value) || 0)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-emerald-400 outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Nozzle Configuration */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Fuel className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-300">Individual Nozzle Configuration</span>
                  </div>
                  {Array.from({ length: newNozzleCount }, (_, index) => {
                    const config =
                      newNozzleConfigs[index] || {
                        tankId: newPumpTankId,
                        nozzleNumber: index + 1,
                        openingMeterReading: newPumpMeter,
                        nozzleName: `Nozzle ${index + 1}`,
                      };
                    const updateConfig = (changes: Partial<NozzleConfig>) => {
                      setNewNozzleConfigs((current) => {
                        const next = [...current];
                        next[index] = { ...config, ...changes };
                        return next;
                      });
                    };
                    return (
                      <div
                        key={index}
                        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4 md:grid-cols-4"
                      >
                        <div>
                          <label className="mb-1 block text-[10px] text-slate-500">Nozzle Number</label>
                          <input type="number" min="1" value={config.nozzleNumber} onChange={(event) => updateConfig({ nozzleNumber: Number(event.target.value) || 0 })} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-emerald-500" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-slate-500">Nozzle Name</label>
                          <input
                            type="text"
                            value={config.nozzleName}
                            onChange={(event) => updateConfig({ nozzleName: event.target.value })}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-slate-500">Source Tank</label>
                          <select
                            value={config.tankId}
                            onChange={(event) => updateConfig({ tankId: event.target.value })}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                          >
                            {safeTanks.map((tank) => (
                              <option key={tank.id} value={tank.id}>
                                {tank.tankName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-slate-500">{editingPumpUnit?'Observed Meter (record only)':'Initial Cumulative Meter Reading'}</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={config.openingMeterReading}
                            onChange={(event) => updateConfig({ openingMeterReading: Number(event.target.value) || 0 })}
                            title={editingPumpUnit ? 'Recorded as an observation. Differences require manager review and do not replace the physical meter.' : 'Initial cumulative meter reading'}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-400 outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <ModalFooter>
                <button
                  type="button"
                  onClick={() => setShowRegisterPumpModal(false)}
                  disabled={isPumpSubmitting}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPumpSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isPumpSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editingPumpUnit ? 'Save Pump Configuration' : 'Register Pump'}
                </button>
              </ModalFooter>
            </form>
          </FMSDialogShell>
        )}

        {viewingPumpUnit && (
          <FMSDialogShell maxWidth="max-w-3xl">
            <ModalHeader title={viewingPumpUnit.pumpName} subtitle={`Physical pump ${viewingPumpUnit.pumpNumber} · ${viewingPumpUnit.status}`} icon={<Fuel className="h-5 w-5" />} onClose={() => setViewingPumpUnit(null)} />
            <div className="space-y-4 p-6 text-xs">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4 sm:grid-cols-4"><div><span className="text-slate-500">Pump number</span><p className="font-bold text-white">{viewingPumpUnit.pumpNumber}</p></div><div><span className="text-slate-500">Physical ID</span><p className="font-mono text-slate-200">{viewingPumpUnit.id}</p></div><div><span className="text-slate-500">Status</span><p className="font-bold text-emerald-400">{viewingPumpUnit.status}</p></div><div><span className="text-slate-500">Nozzles</span><p className="font-bold text-white">{safePumps.filter((nozzle) => nozzle.physicalPumpId === viewingPumpUnit.id).length}</p></div></div>
              <div className="overflow-x-auto rounded-xl border border-slate-800"><table className="w-full text-left"><thead className="bg-slate-950 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Nozzle</th><th className="p-3">Product</th><th className="p-3">Tank</th><th className="p-3">Status</th><th className="p-3">Current meter</th></tr></thead><tbody className="divide-y divide-slate-800">{safePumps.filter((nozzle) => nozzle.physicalPumpId === viewingPumpUnit.id).sort((a, b) => a.nozzleNumber - b.nozzleNumber).map((nozzle) => { const tank = safeTanks.find((item) => item.id === nozzle.tankId); return <tr key={nozzle.id}><td className="p-3 font-bold text-white">{nozzle.nozzleName || `Nozzle ${nozzle.nozzleNumber}`}</td><td className="p-3 text-emerald-300">{nozzle.fuelName || 'Not Assigned'}</td><td className="p-3 text-slate-300">{tank?.tankName || 'Not Assigned'}</td><td className="p-3">{nozzle.status}</td><td className="p-3 font-mono">{Number(nozzle.currentMeterReading).toFixed(2)} L</td></tr>; })}</tbody></table></div>
            </div>
            <ModalFooter><button type="button" onClick={() => setViewingPumpUnit(null)} className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-200">Close</button>{canManagePumps && <button type="button" onClick={() => { const pump = viewingPumpUnit; setViewingPumpUnit(null); openEditPumpDialog(pump); }} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white">Edit Pump</button>}</ModalFooter>
          </FMSDialogShell>
        )}

        {selectedDeliveryReceipt && (
          <div className="pointer-events-none fixed inset-y-0 right-0 z-[110] flex w-full items-start justify-end overflow-y-auto pr-5 pt-14 lg:w-[calc(80mm+1.25rem)]">
            <div className="pointer-events-auto absolute right-3 top-3 z-10 flex items-center gap-2">
              <button type="button" onClick={printDeliveryReceipt} className="rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-slate-100 shadow-lg hover:bg-slate-800" aria-label="Print delivery receipt"><Printer className="h-4 w-4" /></button>
              <button type="button" onClick={downloadDeliveryReceipt} disabled={isGeneratingDeliveryPdf} className="rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-slate-100 shadow-lg hover:bg-slate-800 disabled:opacity-60" aria-label="Download delivery receipt"><Download className="h-4 w-4" /></button>
              <button type="button" onClick={() => setSelectedDeliveryReceipt(null)} className="rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-slate-200 shadow-lg hover:bg-slate-800" aria-label="Close delivery receipt"><X className="h-4 w-4" /></button>
            </div>
            <main ref={deliveryReceiptRef} data-printable-document className="document-preview-paper pointer-events-auto shrink-0 bg-white p-[2mm] font-mono text-[10px] leading-[1.4] text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.18)]" style={{ width: '80mm', maxWidth: '80mm', minWidth: '80mm' }}>
              <div className="border-b border-slate-200 pb-3 text-center">
                <h3 className="text-base font-extrabold uppercase tracking-tight text-slate-900">
                  {stationSettings?.stationName || 'DEITAX FMS.A PETROLEUM LTD'}
                </h3>
                <p className="mt-1 text-[10px] text-slate-600">
                  {stationSettings?.address || 'Westlands Highway Station #04'} | TEL: {stationSettings?.phone || '+254 (0) 700 123 456'}
                </p>
                <p className="text-[10px] text-slate-600">
                  Tax PIN: {stationSettings?.taxPin || 'P051892301A'}
                </p>
              </div>
              <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-[11px]">
                <FuelDeliveryDocument delivery={selectedDeliveryReceipt} settings={stationSettings} />
              </div>
            </main>
          </div>
        )}
      </div>

      {/* ===== Global DEITAX FMS.A Dialog ===== */}
      <DTFMSDialog
        dialog={dialog}
        onClose={closeDialog}
        onConfirm={handleDialogConfirm}
        isSubmitting={isDialogSubmitting}
      />
    </>
  );
};
