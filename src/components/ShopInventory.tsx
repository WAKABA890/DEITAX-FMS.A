import React, { useState } from 'react';
import {
  Package,
  Search,
  Plus,
  Edit3,
  ShieldAlert,
  AlertTriangle,
  DollarSign,
  Tag,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  X,
  FileText,
  Download,
} from 'lucide-react';
import { ShopItem, User } from '../types';
import { PaginationControls, usePagination } from './PaginationControls';
import * as XLSX from 'xlsx';
import { usePermissions } from '../hooks/usePermissions';

// ============================
// CUSTOM DIALOG COMPONENT (DT-FMS)
// ============================

interface DialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'confirm';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  danger?: boolean;
}

const FMSDialog: React.FC<DialogProps> = ({
  isOpen,
  title,
  message,
  type,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  danger = false,
}) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="h-6 w-6 text-emerald-400" />;
      case 'error':
        return <AlertTriangle className="h-6 w-6 text-rose-400" />;
      case 'warning':
        return <AlertTriangle className="h-6 w-6 text-amber-400" />;
      case 'confirm':
        return danger ? (
          <AlertTriangle className="h-6 w-6 text-rose-400" />
        ) : (
          <AlertTriangle className="h-6 w-6 text-emerald-400" />
        );
      default:
        return <CheckCircle2 className="h-6 w-6 text-sky-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              {getIcon()}
            </div>
            <h3 className="text-sm font-bold text-white">{title}</h3>
          </div>
          {(type !== 'confirm' || !danger) && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="p-5">
          <p className="text-sm leading-relaxed text-slate-300">{message}</p>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-800 bg-slate-950/40 px-5 py-4">
          {type === 'confirm' ? (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-700"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`rounded-xl px-4 py-2 text-xs font-bold text-white transition ${
                  danger
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {confirmLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
            >
              Understood
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================
// MAIN COMPONENT
// ============================

interface ShopInventoryProps {
  shopItems: ShopItem[];
  currentUser: User;
  onAdjustStock: (itemId: string, newQty: number, reason: string) => Promise<any>;
  onRegisterItem?: (itemData: any) => Promise<any>;
  onUpdateItem?: (itemId: string, itemData: any) => Promise<any>;
  onDeleteItem?: (itemId: string) => Promise<any>;
  onUploadBulkExcel?: (items: any[]) => Promise<any>;
}

export const ShopInventory: React.FC<ShopInventoryProps> = ({
  shopItems = [],
  currentUser,
  onAdjustStock,
  onRegisterItem,
  onUpdateItem,
  onDeleteItem,
  onUploadBulkExcel,
}) => {
  // 🔐 Permissions – all buttons use canManageShop as the master switch
  const {
    canCreateShopItem,
    canUpdateShopItem,
    canDeleteShopItem,
    canBulkUploadShopItems,
    canAdjustStock,
    canManageShop,          // 👈 MASTER SWITCH – true if ANY shop permission is granted
  } = usePermissions(currentUser);

  // ----- SAFE DATA -----
  const safeShopItems = Array.isArray(shopItems) ? shopItems : [];

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [editingItem, setEditingItem] = useState<ShopItem | null>(null);
  const [editingInventoryItem, setEditingInventoryItem] = useState<ShopItem | null>(null);
  const [newQtyInput, setNewQtyInput] = useState<number>(0);
  const [reasonInput, setReasonInput] = useState<string>('Stock Audit Adjustment');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // ----- Dialog State -----
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning' | 'confirm';
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
    danger?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
  });

  const showDialog = (
    title: string,
    message: string,
    type: 'info' | 'success' | 'error' | 'warning' | 'confirm' = 'info',
    onConfirm?: () => void,
    onCancel?: () => void,
    confirmLabel?: string,
    cancelLabel?: string,
    danger?: boolean
  ) => {
    setDialog({
      isOpen: true,
      title,
      message,
      type,
      confirmLabel,
      cancelLabel,
      onConfirm: onConfirm || (() => setDialog((prev) => ({ ...prev, isOpen: false }))),
      onCancel: onCancel || (() => setDialog((prev) => ({ ...prev, isOpen: false }))),
      danger,
    });
  };

  const closeDialog = () => {
    setDialog((prev) => ({ ...prev, isOpen: false }));
  };

  // ----- Register Item Modal State -----
  const [showRegisterModal, setShowRegisterModal] = useState<boolean>(false);
  const [regCode, setRegCode] = useState('');
  const [regName, setRegName] = useState('');
  const [regCategory, setRegCategory] = useState('General');
  const [regTaxCode, setRegTaxCode] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('C');
  const [regCountry, setRegCountry] = useState<'KE' | 'UG' | 'TZ' | 'US' | 'UK' | 'EU' | 'NG' | 'ZA'>('KE');
  const [regCurrency, setRegCurrency] = useState<'KES' | 'UGX' | 'TZS' | 'USD' | 'GBP' | 'EUR' | 'NGN' | 'ZAR'>('KES');
  const [regProductType, setRegProductType] = useState<1 | 2 | 3>(2);
  const [regUnit, setRegUnit] = useState<'Pieces' | 'KG' | 'Litre' | 'Box' | 'Carton' | 'Bag' | 'Bottle' | 'Pack' | 'Set' | 'Roll' | 'Can'>('Pieces');
  const [regUnitPrice, setRegUnitPrice] = useState<number>(100);
  const [regCostPrice, setRegCostPrice] = useState<number>(80);
  const [regStockQty, setRegStockQty] = useState<number>(10);
  const [regReorderLevel, setRegReorderLevel] = useState<number>(5);

  // ----- Excel Upload Modal State -----
  const [showExcelModal, setShowExcelModal] = useState<boolean>(false);
  const [excelText, setExcelText] = useState<string>('');
  const [parsedExcelRows, setParsedExcelRows] = useState<any[]>([]);
  const [excelStatusMsg, setExcelStatusMsg] = useState<string | null>(null);

  const categories = [
    'All',
    'Lubricants',
    'Gas Cylinders',
    'Car Care',
    'Snacks & Drinks',
    'General',
  ];

  // ----- Filtered items -----
  const filteredItems = safeShopItems.filter((i) => {
    const matchesSearch =
      (i.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (i.code || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = selectedCategory === 'All' || i.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const inventoryPagination = usePagination(
    filteredItems,
    `${selectedCategory}:${searchTerm.trim().toLowerCase()}`
  );

  const lowStockCount = safeShopItems.filter((i) => i.stockQty <= i.reorderLevel).length;
  const totalStockVal = safeShopItems.reduce((sum, i) => sum + i.unitPrice * i.stockQty, 0);

  // ----- Handlers with canManageShop as fallback -----

  const handleAdjustSubmit = async () => {
    // Adjust Stock still uses its own permission (no fallback needed, but canManageShop works too)
    if (!canAdjustStock) {
      showDialog('Permission Denied', 'You do not have permission to adjust stock.', 'error');
      return;
    }
    if (!editingItem) return;
    if (!onAdjustStock) {
      showDialog(
        'Function Unavailable',
        'Stock adjustment function is not available right now. Please contact support.',
        'error'
      );
      return;
    }
    setIsSubmitting(true);
    try {
      await onAdjustStock(editingItem.id, newQtyInput, reasonInput);
      setEditingItem(null);
      showDialog(
        'Stock Adjusted',
        `Stock quantity for "${editingItem.name}" updated successfully.`,
        'success'
      );
    } catch (err) {
      console.error(err);
      showDialog('Adjustment Failed', 'Unable to adjust stock. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Allow if granular OR canManageShop is true
    const canPerform = editingInventoryItem
      ? (canUpdateShopItem || canManageShop)
      : (canCreateShopItem || canManageShop);
    if (!canPerform) {
      showDialog('Permission Denied', 'You do not have permission to manage shop items.', 'error');
      return;
    }

    if (!regName.trim()) {
      showDialog('Missing Name', 'Please enter an item name.', 'warning');
      return;
    }
    if (!regTaxCode) {
      showDialog('Missing Tax Code', 'Please select a tax code for the item.', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const itemPayload = {
        code: regCode || `ITM-${Math.floor(100 + Math.random() * 900)}`,
        name: regName,
        category: regCategory,
        unitPrice: regUnitPrice,
        price: regUnitPrice,
        costPrice: regCostPrice,
        stockQty: regStockQty,
        reorderLevel: regReorderLevel,
        requireShiftCount: true,
        taxCode: regTaxCode,
        taxType: regTaxCode,
        country: regCountry,
        currency: regCurrency,
        productType: regProductType,
        unit: regUnit,
      };

      if (editingInventoryItem) {
        if (onUpdateItem) {
          await onUpdateItem(editingInventoryItem.id, itemPayload);
        } else {
          showDialog('Function Unavailable', 'Update function is not available.', 'error');
          return;
        }
      } else if (onRegisterItem) {
        await onRegisterItem(itemPayload);
      } else {
        showDialog('Function Unavailable', 'Registration function is not available.', 'error');
        return;
      }

      setShowRegisterModal(false);
      setEditingInventoryItem(null);
      setRegName('');
      setRegCode('');
      setRegCategory('General');
      setRegTaxCode('C');
      setRegCountry('KE');
      setRegCurrency('KES');
      setRegProductType(2);
      setRegUnit('Pieces');
      setRegUnitPrice(100);
      setRegCostPrice(80);
      setRegStockQty(10);
      setRegReorderLevel(5);
      showDialog(
        editingInventoryItem ? 'Item Updated' : 'Item Registered',
        `Shop item "${regName}" ${editingInventoryItem ? 'updated' : 'registered'} successfully.`,
        'success'
      );
    } catch (err: any) {
      showDialog(
        'Operation Failed',
        err.message || (editingInventoryItem ? 'Failed to update item.' : 'Failed to register new item.'),
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Excel parser (unchanged) ----
  const handleParseExcel = (raw: string) => {
    setExcelText(raw);
    if (!raw.trim()) {
      setParsedExcelRows([]);
      return;
    }

    const lines = raw.trim().split(/\r?\n/).filter(Boolean);
    const rows: any[] = [];

    lines.forEach((line, index) => {
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      const normalizedParts = parts.map((p) => p.trim());
      if (normalizedParts.length < 2) return;

      const header = normalizedParts[0]?.toLowerCase();
      if (index === 0 && (header.includes('code') || header.includes('name'))) {
        return;
      }

      const isLegacyFormat =
        normalizedParts.length >= 12 &&
        !/^[ABCDEF]$/i.test(normalizedParts[3] || '') &&
        !/^[123]$/i.test(normalizedParts[4] || '');

      let code = normalizedParts[0] || `XLS-${Math.floor(100 + Math.random() * 900)}`;
      let category = normalizedParts[1] || 'General';
      let name = normalizedParts[2] || `Item ${index + 1}`;
      let taxTypeValue = (normalizedParts[3] || 'C').toUpperCase() as 'A' | 'B' | 'C' | 'D' | 'E';
      let productTypeValue = Number(normalizedParts[4] || 2) as 1 | 2 | 3;
      let country = (normalizedParts[5] || 'KE').toUpperCase();
      let currency = (normalizedParts[6] || 'KES').toUpperCase();
      let unit = normalizedParts[7] || 'Pieces';
      let unitPrice = parseFloat(normalizedParts[8]) || 100;
      let costPrice = parseFloat(normalizedParts[9]) || unitPrice * 0.8 || 80;
      let stockQty = parseInt(normalizedParts[10], 10) || 10;
      let reorderLevel = parseInt(normalizedParts[11], 10) || 5;

      if (isLegacyFormat) {
        code = normalizedParts[0] || `XLS-${Math.floor(100 + Math.random() * 900)}`;
        name = normalizedParts[1] || `Item ${index + 1}`;
        category = normalizedParts[2] || 'General';
        unitPrice = parseFloat(normalizedParts[3]) || parseFloat(normalizedParts[4]) || 100;
        costPrice = parseFloat(normalizedParts[4]) || parseFloat(normalizedParts[3]) * 0.8 || 80;
        stockQty = parseInt(normalizedParts[5], 10) || 10;
        reorderLevel = parseInt(normalizedParts[6], 10) || 5;
        country = (normalizedParts[7] || 'KE').toUpperCase();
        currency = (normalizedParts[8] || 'KES').toUpperCase();
        taxTypeValue = ((normalizedParts[9] || 'C').toUpperCase() as 'A' | 'B' | 'C' | 'D' | 'E');
        unit = normalizedParts[10] || 'Pieces';
        productTypeValue = Number(normalizedParts[11] || 2) as 1 | 2 | 3;
      }

      rows.push({
        code,
        name,
        category,
        unitPrice,
        price: unitPrice,
        costPrice,
        stockQty,
        reorderLevel,
        country,
        currency,
        taxType: taxTypeValue,
        taxCode: taxTypeValue,
        unit,
        productType: productTypeValue,
        requireShiftCount: true,
      });
    });

    setParsedExcelRows(rows);
  };

  // ---- File upload ----
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];

        const tsvLines = jsonData
          .filter((row) => Array.isArray(row) && row.some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== ''))
          .map((row) => row.map((cell) => String(cell ?? '').trim()).join('\t'));

        if (tsvLines.length === 0) {
          setParsedExcelRows([]);
          setExcelStatusMsg('The selected file had no readable rows.');
          setTimeout(() => setExcelStatusMsg(null), 3000);
          return;
        }

        handleParseExcel(tsvLines.join('\n'));
        setExcelText('');
        setExcelStatusMsg(`File loaded and parsed successfully.`);
        setTimeout(() => setExcelStatusMsg(null), 3000);
      } catch (error) {
        console.error('Excel parsing error:', error);
        showDialog(
          'File Parsing Error',
          'Failed to parse the Excel file. Please check the format and try again.',
          'error'
        );
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleImportExcelSubmit = async () => {
    if (!canBulkUploadShopItems && !canManageShop) {
      showDialog('Permission Denied', 'You do not have permission to bulk import items.', 'error');
      return;
    }

    if (parsedExcelRows.length === 0) {
      showDialog(
        'No Data',
        'No valid spreadsheet rows detected. Please paste TSV/CSV text or upload a file.',
        'warning'
      );
      return;
    }

    if (!onUploadBulkExcel) {
      showDialog(
        'Function Unavailable',
        'Bulk upload function is not available right now. Please contact support.',
        'error'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await onUploadBulkExcel(parsedExcelRows);
      setExcelStatusMsg(`Successfully imported ${parsedExcelRows.length} items into inventory.`);
      setTimeout(() => {
        setExcelStatusMsg(null);
        setShowExcelModal(false);
        setExcelText('');
        setParsedExcelRows([]);
      }, 1500);
      showDialog(
        'Import Successful',
        `${parsedExcelRows.length} items imported into inventory.`,
        'success'
      );
    } catch (err: any) {
      showDialog(
        'Import Failed',
        err.message || 'Failed to import Excel items.',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditInventoryItemModal = (item: ShopItem) => {
    if (!canUpdateShopItem && !canManageShop) {
      showDialog('Permission Denied', 'You do not have permission to edit items.', 'error');
      return;
    }
    setEditingInventoryItem(item);
    setRegCode(item.code);
    setRegName(item.name);
    setRegCategory(item.category || 'General');
    setRegTaxCode((item.taxCode || item.taxType || 'C') as 'A' | 'B' | 'C' | 'D' | 'E');
    setRegCountry((item.country || 'KE') as 'KE' | 'UG' | 'TZ' | 'US' | 'UK' | 'EU' | 'NG' | 'ZA');
    setRegCurrency((item.currency || 'KES') as 'KES' | 'UGX' | 'TZS' | 'USD' | 'GBP' | 'EUR' | 'NGN' | 'ZAR');
    setRegProductType((item.productType || 2) as 1 | 2 | 3);
    setRegUnit((item.unit || 'Pieces') as 'Pieces' | 'KG' | 'Litre' | 'Box' | 'Carton' | 'Bag' | 'Bottle' | 'Pack' | 'Set' | 'Roll' | 'Can');
    setRegUnitPrice(item.unitPrice);
    setRegCostPrice(item.costPrice);
    setRegStockQty(item.stockQty);
    setRegReorderLevel(item.reorderLevel);
    setShowRegisterModal(true);
  };

  const handleDeleteInventoryItem = async (item: ShopItem) => {
    if (!canDeleteShopItem && !canManageShop) {
      showDialog('Permission Denied', 'You do not have permission to delete items.', 'error');
      return;
    }

    if (!onDeleteItem) {
      showDialog(
        'Function Unavailable',
        'Delete function is not available right now. Please contact support.',
        'error'
      );
      return;
    }

    showDialog(
      'Confirm Delete',
      `Are you sure you want to delete "${item.name}" from inventory? This action cannot be undone.`,
      'confirm',
      async () => {
        try {
          await onDeleteItem(item.id);
          showDialog(
            'Item Deleted',
            `"${item.name}" has been deleted from inventory.`,
            'success'
          );
        } catch (err) {
          console.error(err);
          showDialog(
            'Delete Failed',
            'Unable to delete this item right now. Please try again.',
            'error'
          );
        }
      },
      undefined,
      'Yes, Delete',
      'Cancel',
      true
    );
  };

  const loadSampleExcelData = () => {
    const sample = `Code,Category,Name,TaxType,ProductType,Country,Currency,Unit,Price,CostPrice,StockQty,ReorderLevel
LUB-HLX-01,Lubricants,Shell Helix Ultra 5W-30 4L,C,2,KE,KES,Litre,4800,3800,15,4
LUB-RIM-02,Lubricants,Shell Rimula R4 X 15W-40 20L,C,2,KE,KES,Box,14500,12000,8,2
GAS-LPG-13,Gas Cylinders,K-Gas Cylinder 13kg Full Refill,C,2,KE,KES,Piece,3200,2700,25,5
GAS-LPG-06,Gas Cylinders,K-Gas Cylinder 6kg Full Refill,C,2,KE,KES,Piece,1650,1350,30,8
CAR-WSH-01,Car Care,Turtle Wax Ice Car Wash 1L,C,2,KE,KES,Bottle,1250,900,12,3
SNK-RED-01,Snacks & Drinks,Red Bull Energy Drink 250ml,C,2,KE,KES,Can,220,160,48,12`;
    handleParseExcel(sample);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-400" />
            Fuel Products, Lubricants & Convenience Shop Inventory
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Register new products, upload batch Excel sheets, track profit margins, and perform stock count audits.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* ✅ "Register Item" – shows if granular OR canManageShop */}
          {(canCreateShopItem || canManageShop) && (
            <button
              onClick={() => setShowRegisterModal(true)}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20"
            >
              <Plus className="w-4 h-4" />
              <span>Register Item</span>
            </button>
          )}

          {/* ✅ "Upload Excel Sheet" – shows if granular OR canManageShop */}
          {(canBulkUploadShopItems || canManageShop) && (
            <button
              onClick={() => setShowExcelModal(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/20"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Upload Excel Sheet</span>
            </button>
          )}

          <div className="bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800 text-xs font-mono">
            <span className="text-slate-400 block text-[10px]">TOTAL STOCK VALUE</span>
            <span className="text-emerald-400 font-bold text-sm">
              KES {totalStockVal.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {lowStockCount > 0 && (
            <div className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-3 py-2 rounded-xl text-xs font-mono flex items-center gap-1.5 animate-pulse">
              <AlertTriangle className="w-4 h-4" />
              <span>{lowStockCount} Low Stock</span>
            </div>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex overflow-x-auto gap-2 w-full sm:w-auto scrollbar-none pb-1 sm:pb-0">
          {categories.map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border flex-shrink-0 ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/20'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat === 'All' ? 'All Items' : cat}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64 md:w-80 flex-shrink-0">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
          <input
            type="text"
            placeholder="Search code or product name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Item Name / Product Code</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Cost Price (KES)</th>
                <th className="py-3 px-4 text-right">Selling Price (KES)</th>
                <th className="py-3 px-4 text-center">In-Stock Qty</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {inventoryPagination.pageItems.map((item) => {
                const isLow = item.stockQty <= item.reorderLevel;
                const margin = item.unitPrice > 0 ? ((item.unitPrice - item.costPrice) / item.unitPrice) * 100 : 0;
                return (
                  <tr key={item.id} className="hover:bg-slate-850/50 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-200">
                      <div>{item.name}</div>
                      <div className="text-[10px] text-blue-400">Code: {item.code}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      <span className="px-2 py-0.5 bg-slate-950 border border-slate-800 rounded text-[10px]">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400">KES {item.costPrice.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-400">
                      <div>KES {item.unitPrice.toFixed(2)}</div>
                      <div className="text-[10px] text-slate-500 font-normal">Margin: {margin.toFixed(0)}%</div>
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-sm text-slate-100">{item.stockQty}</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold border ${
                          isLow
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/30 animate-pulse'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}
                      >
                        {isLow ? 'LOW STOCK' : 'IN STOCK'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {/* ✅ "Adjust Stock" – uses canAdjustStock */}
                        {(canAdjustStock || canManageShop)&& (
                          <button
                            onClick={() => {
                              setEditingItem(item);
                              setNewQtyInput(item.stockQty);
                            }}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-sans font-medium transition-colors border border-slate-700/60"
                          >
                            Adjust Stock
                          </button>
                        )}

                        {/* ✅ "Edit" – shows if granular OR canManageShop */}
                        {(canUpdateShopItem || canManageShop) && (
                          <button
                            onClick={() => openEditInventoryItemModal(item)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-lg text-[11px] font-sans font-medium transition-colors border border-slate-700/60"
                          >
                            Edit
                          </button>
                        )}

                        {/* ✅ "Delete" – shows if granular OR canManageShop */}
                        {(canDeleteShopItem || canManageShop) && (
                          <button
                            onClick={() => handleDeleteInventoryItem(item)}
                            className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded-lg text-[11px] font-sans font-medium transition-colors border border-rose-500/20"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationControls
          currentPage={inventoryPagination.currentPage}
          totalPages={inventoryPagination.totalPages}
          itemCount={filteredItems.length}
          onPageChange={inventoryPagination.setCurrentPage}
        />
      </div>

      {/* Register Single Item Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100 my-8 shadow-2xl relative">
            <button
              onClick={() => setShowRegisterModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">
                  {editingInventoryItem ? 'Edit Inventory Item' : 'Register New Inventory Item'}
                </h3>
                <p className="text-xs text-slate-400">Add or update a shop product, lubricant, cylinder, or fuel item.</p>
              </div>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Product Code (SKU) <span className="text-slate-500">optional</span></label>
                  <input
                    type="text"
                    placeholder="Optional: e.g. LUB-RIM-04"
                    value={regCode}
                    onChange={(e) => setRegCode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Category</label>
                  <select
                    value={regCategory}
                    onChange={(e) => setRegCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value="Lubricants">Lubricants</option>
                    <option value="Gas Cylinders">Gas Cylinders</option>
                    <option value="Car Care">Car Care</option>
                    <option value="Snacks & Drinks">Snacks & Drinks</option>
                    <option value="General">General</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Shell Helix HX7 10W-40 4L"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Tax Type</label>
                  <select
                    value={regTaxCode}
                    onChange={(e) => setRegTaxCode(e.target.value as 'A' | 'B' | 'C' | 'D' | 'E')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value="A">A — EXEMPT GOODS/SERVICES == 0%</option>
                    <option value="B">B — VAT Act — 16%</option>
                    <option value="C">C — ZERO RATED — 0%</option>
                    <option value="D">D — NON-VAT — 0%</option>
                    <option value="E">E — SPECIAL RATE — 8%</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Product Type</label>
                  <select
                    value={regProductType}
                    onChange={(e) => setRegProductType(Number(e.target.value) as 1 | 2 | 3)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value={1}>1 – Raw material</option>
                    <option value={2}>2 – Finished goods</option>
                    <option value={3}>3 – Services</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Country</label>
                  <select
                    value={regCountry}
                    onChange={(e) => setRegCountry(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value="KE">KE</option>
                    <option value="UG">UG</option>
                    <option value="TZ">TZ</option>
                    <option value="US">US</option>
                    <option value="UK">UK</option>
                    <option value="EU">EU</option>
                    <option value="NG">NG</option>
                    <option value="ZA">ZA</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Currency</label>
                  <select
                    value={regCurrency}
                    onChange={(e) => setRegCurrency(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value="KES">KES</option>
                    <option value="UGX">UGX</option>
                    <option value="TZS">TZS</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="EUR">EUR</option>
                    <option value="NGN">NGN</option>
                    <option value="ZAR">ZAR</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Unit</label>
                  <select
                    value={regUnit}
                    onChange={(e) => setRegUnit(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                  >
                    <option value="Pieces">Pieces</option>
                    <option value="KG">KG</option>
                    <option value="Litre">Litre</option>
                    <option value="Box">Box</option>
                    <option value="Carton">Carton</option>
                    <option value="Bag">Bag</option>
                    <option value="Bottle">Bottle</option>
                    <option value="Pack">Pack</option>
                    <option value="Set">Set</option>
                    <option value="Roll">Roll</option>
                    <option value="Can">Can</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Selling Price (KES)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={regUnitPrice}
                    onChange={(e) => setRegUnitPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-emerald-400 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Cost Price (KES)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={regCostPrice}
                    onChange={(e) => setRegCostPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Initial In-Stock Qty</label>
                  <input
                    type="number"
                    required
                    value={regStockQty}
                    onChange={(e) => setRegStockQty(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Reorder Alert Threshold</label>
                <input
                  type="number"
                  required
                  value={regReorderLevel}
                  onChange={(e) => setRegReorderLevel(parseInt(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                />
              </div>

              <div className="pt-3 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-600/20"
                >
                  {isSubmitting ? 'Saving...' : editingInventoryItem ? 'Update Item' : 'Register Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Items via Excel Sheet Modal */}
      {showExcelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100 my-8 shadow-2xl relative">
            <button
              onClick={() => setShowExcelModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Upload New Items on Excel / CSV Sheet</h3>
                <p className="text-xs text-slate-400">
                  Upload an Excel file (.xlsx, .xls) or paste CSV/TSV text for bulk registration.
                </p>
              </div>
            </div>

            {excelStatusMsg ? (
              <div className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 p-4 rounded-xl text-xs flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>{excelStatusMsg}</span>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-bold cursor-pointer transition-colors shadow-md shadow-blue-600/20">
                    <Upload className="w-4 h-4" />
                    <span>Choose Excel File</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  <span className="text-slate-400 text-[11px]">
                    Upload .xlsx or .xls file with columns: Code, Category, Name, TaxType, ProductType, Country, Currency, Unit, Price, CostPrice, StockQty, ReorderLevel
                  </span>
                </div>

                <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="text-[11px] text-slate-400">
                    Expected Columns: <span className="text-slate-200 font-mono">Code, Category, Name, TaxType, ProductType, Country, Currency, Unit, Price, CostPrice, StockQty, ReorderLevel</span>
                  </div>
                  <button
                    type="button"
                    onClick={loadSampleExcelData}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-bold text-[11px]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Load Sample Data</span>
                  </button>
                </div>

                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-[10px] text-slate-300 leading-relaxed">
                  <div className="font-bold text-blue-300 mb-1">VAT / product type guide</div>
                  <div>
                    Product Type: 1 = Raw material, 2 = Finished goods, 3 = Services. Tax Type: A = EXEMPT GOODS/SERVICES == 0%, B = VAT Act — 16%, C = ZERO RATED — 0%, D = NON-VAT — 0%, E = SPECIAL RATE — 8%.
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">— OR — Paste CSV / TSV Text</label>
                  <textarea
                    rows={5}
                    placeholder="Paste Excel lines here (e.g. LUB-01, Lubricants, Shell Helix Ultra 4L, C, 2, KE, KES, Litre, 4800, 3800, 20, 5)..."
                    value={excelText}
                    onChange={(e) => handleParseExcel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {parsedExcelRows.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
                      <span>Parsed Excel Preview ({parsedExcelRows.length} Items)</span>
                      <span className="text-[10px] text-emerald-400 font-normal">Ready for Bulk Upload</span>
                    </h4>

                    <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950 p-2">
                      <table className="w-full text-left text-[11px] font-mono text-slate-300">
                        <thead className="text-slate-500 uppercase border-b border-slate-800 text-[9px]">
                          <tr>
                            <th className="p-1.5">Code</th>
                            <th className="p-1.5">Name</th>
                            <th className="p-1.5">Category</th>
                            <th className="p-1.5 text-right">Selling Price</th>
                            <th className="p-1.5 text-right">Stock</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {parsedExcelRows.map((row, idx) => (
                            <tr key={idx}>
                              <td className="p-1.5 text-blue-400">{row.code}</td>
                              <td className="p-1.5 text-slate-200 font-bold">{row.name}</td>
                              <td className="p-1.5 text-slate-400">{row.category}</td>
                              <td className="p-1.5 text-right text-emerald-400">KES {row.unitPrice}</td>
                              <td className="p-1.5 text-right text-white font-bold">{row.stockQty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowExcelModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleImportExcelSubmit}
                    disabled={isSubmitting || parsedExcelRows.length === 0}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-600/20 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Importing...' : `Import ${parsedExcelRows.length} Items`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stock Adjust Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100 shadow-2xl">
            <h3 className="font-bold text-base text-slate-100">Adjust Stock Quantity — {editingItem.name}</h3>

            <div>
              <label className="block text-xs text-slate-400 mb-1">New In-Stock Quantity</label>
              <input
                type="number"
                value={newQtyInput}
                onChange={(e) => setNewQtyInput(parseInt(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-lg font-mono font-bold text-emerald-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Reason for Audit Adjustment</label>
              <input
                type="text"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setEditingItem(null)}
                className="w-1/2 py-2.5 bg-slate-800 text-slate-300 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleAdjustSubmit}
                disabled={isSubmitting}
                className="w-1/2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl"
              >
                Save Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Dialog */}
      <FMSDialog
        isOpen={dialog.isOpen}
        title={dialog.title}
        message={dialog.message}
        type={dialog.type}
        confirmLabel={dialog.confirmLabel}
        cancelLabel={dialog.cancelLabel}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel || closeDialog}
        danger={dialog.danger}
      />
    </div>
  );
};