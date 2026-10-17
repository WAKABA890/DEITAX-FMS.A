import React, { useEffect, useState } from 'react';
import {
  Package,
  Fuel,
  TrendingUp,
  AlertTriangle,
  Sliders,
  Search,
  Plus,
  History,
  CheckCircle2,
  X,
  Scale,
  RefreshCw,
  ShoppingBag,
  DollarSign,
  AlertCircle,
  BarChart2,
} from 'lucide-react';
import {
  FuelTank,
  ShopItem,
  StockAdjustment,
  User,
  FuelProduct,
} from '../types';
import { PaginationControls, usePagination } from './PaginationControls';
import { api } from '../services/api';
import { usePermissions } from '../hooks/usePermissions';
import { AppDialog } from './AppDialog';

interface StockManagementProps {
  tanks?: FuelTank[];
  shopItems?: ShopItem[];
  products?: FuelProduct[];
  adjustments?: StockAdjustment[];
  currentUser?: User;
  onRecordStockAdjustment?: (data: any) => Promise<any>;
  onSaveShopItem?: (data: any) => Promise<any>;
  onUpdateShopItem?: (itemId: string, data: any) => Promise<any>;
  onDeleteShopItem?: (itemId: string) => Promise<any>;
}

export const StockManagement: React.FC<StockManagementProps> = ({
  tanks = [],
  shopItems = [],
  products = [],
  adjustments = [],
  currentUser,
  onRecordStockAdjustment,
  onSaveShopItem,
  onUpdateShopItem,
  onDeleteShopItem,
}) => {
  const { hasPermission } = usePermissions(currentUser ?? null);
  const canAdjustStock = hasPermission('ADJUST_STOCK');
  const canManageShopItems = hasPermission('MANAGE_SHOP_ITEMS');

  const [activeTab, setActiveTab] = useState<'overview' | 'shop-items' | 'adjustments'>('overview');
  const [shopItemToDelete, setShopItemToDelete] = useState<ShopItem | null>(null);
  const [deletingShopItem, setDeletingShopItem] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Stock Adjustment Modal State
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [adjType, setAdjType] = useState<'Fuel' | 'Shop'>('Shop');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [adjNewQty, setAdjNewQty] = useState<number>(0);
  const [adjReason, setAdjReason] = useState<
    'Damage/Spill' | 'Stock Take Audit' | 'Calibration' | 'Theft/Loss' | 'Initial Count' | 'Restock' | 'Other'
  >('Stock Take Audit');
  const [isSubmittingAdj, setIsSubmittingAdj] = useState(false);

  // Shop Item Add / Edit Modal
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ShopItem | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState('Engine Oil');
  const [itemTaxCode, setItemTaxCode] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('A');
  const [itemCountry, setItemCountry] = useState<'KE' | 'UG' | 'TZ' | 'US' | 'UK' | 'EU' | 'NG' | 'ZA'>('KE');
  const [itemCurrency, setItemCurrency] = useState<'KES' | 'UGX' | 'TZS' | 'USD' | 'GBP' | 'EUR' | 'NGN' | 'ZAR'>('KES');
  const [itemProductType, setItemProductType] = useState<1 | 2 | 3>(1);
  const [itemUnit, setItemUnit] = useState<'Pieces' | 'KG' | 'Litre' | 'Box' | 'Carton' | 'Bag' | 'Bottle' | 'Pack' | 'Set' | 'Roll' | 'Can'>('Pieces');
  const [itemCost, setItemCost] = useState(1200);
  const [itemPrice, setItemPrice] = useState(1500);
  const [itemQty, setItemQty] = useState(50);
  const [itemReorder, setItemReorder] = useState(10);
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const STOCK_AUDIT_PAGE_SIZE = 10;
  const [adjustmentPage, setAdjustmentPage] = useState(1);
  const [remoteAdjustments, setRemoteAdjustments] = useState<StockAdjustment[]>([]);
  const [adjustmentTotal, setAdjustmentTotal] = useState(0);
  const [adjustmentTotalPages, setAdjustmentTotalPages] = useState(0);
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);
  const [adjustmentsError, setAdjustmentsError] = useState<string | null>(null);

  // Valuation Calculations
  const toSafeNumber = (value: unknown, fallback = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  };
  const formatAuditTimestamp = (value?: string) => {
    const raw = String(value || '').trim();
    // SQLite CURRENT_TIMESTAMP is UTC but has no offset; label it before browser parsing.
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
      ? raw.replace(' ', 'T') + 'Z'
      : raw;
    const parsed = normalized ? new Date(normalized) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : 'Legacy record (date unavailable)';
  };

  const getFuelCostPerLiter = (tank: FuelTank | undefined) => {
    if (!tank) return 0;
    const product = products.find((item) => item.id === tank.fuelProductId);
    const unitValue = toSafeNumber(product?.costPerLiter, toSafeNumber(product?.pricePerLiter, 0));
    return unitValue > 0 ? unitValue : 0;
  };

  const getFuelRetailPricePerLiter = (tank: FuelTank | undefined) => {
    if (!tank) return 0;
    const product = products.find((item) => item.id === tank.fuelProductId);
    const unitValue = toSafeNumber(product?.pricePerLiter, toSafeNumber(product?.costPerLiter, 0));
    return unitValue > 0 ? unitValue : 0;
  };

  const tankValuationRows = tanks
    .map((tank) => {
      const liters = toSafeNumber(tank.currentLevelLiters, 0);
      const unitValue = getFuelRetailPricePerLiter(tank);
      const value = liters * unitValue;
      return { tank, liters, unitValue, value };
    })
    .filter((entry) => entry.liters > 0 || entry.value > 0);

  const fuelProductTotals = products
    .map((product) => {
      const liters = tankValuationRows
        .filter((entry) => entry.tank.fuelProductId === product.id)
        .reduce((sum, entry) => sum + entry.liters, 0);
      const unitValue = toSafeNumber(product.pricePerLiter, toSafeNumber(product.costPerLiter, 0));
      const value = liters * unitValue;
      return { product, liters, value };
    })
    .filter((entry) => entry.liters > 0 || entry.value > 0);

  const fuelStockValuation = tankValuationRows.reduce((sum, entry) => sum + entry.value, 0);
  const fuelVolumeTotal = tanks.reduce((sum, tank) => sum + toSafeNumber(tank.currentLevelLiters, 0), 0);

  const shopStockValuation = shopItems.reduce(
    (sum, item) => sum + toSafeNumber(item.stockQty, 0) * toSafeNumber(item.unitPrice, toSafeNumber(item.price, toSafeNumber(item.costPrice, 0))),
    0
  );

  const lowStockShopCount = shopItems.filter((i) => i.stockQty <= i.reorderLevel).length;
  const lowStockTankCount = tanks.filter((t) => t.currentLevelLiters <= t.reorderLevelLiters).length;

  const getTankValue = (tank: FuelTank | undefined, liters = tank?.currentLevelLiters ?? 0) => {
    const safeLiters = toSafeNumber(liters, 0);
    return safeLiters * getFuelRetailPricePerLiter(tank);
  };

  const getAdjustmentValue = (adj: StockAdjustment) => {
    if (adj.type === 'Fuel') {
      const tank = tanks.find((item) => item.id === adj.itemId);
      return adj.differenceQty * getFuelRetailPricePerLiter(tank);
    }
    const item = shopItems.find((entry) => entry.id === adj.itemId);
    return adj.differenceQty * toSafeNumber(item?.unitPrice, toSafeNumber(item?.price, toSafeNumber(item?.costPrice, 0)));
  };

  const openAdjustmentModalFor = (type: 'Fuel' | 'Shop', item?: FuelTank | ShopItem) => {
    if (!canAdjustStock) return;
    setAdjType(type);
    if (type === 'Fuel') {
      const targetTank = item ? (item as FuelTank) : tanks[0];
      setSelectedItemId(targetTank?.id || '');
      setAdjNewQty(targetTank ? targetTank.currentLevelLiters : 0);
    } else {
      const targetItem = item ? (item as ShopItem) : shopItems[0];
      setSelectedItemId(targetItem?.id || '');
      setAdjNewQty(targetItem ? targetItem.stockQty : 0);
    }
    setAdjReason('Stock Take Audit');
    setShowAdjustmentModal(true);
  };

  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) {
      setFeedback({ type: 'error', message: 'Please select an item or tank to adjust.' });
      return;
    }

    setIsSubmittingAdj(true);
    setFeedback(null);
    try {
      if (onRecordStockAdjustment) {
        const selectedTank = adjType === 'Fuel' ? tanks.find((tank) => tank.id === selectedItemId) : undefined;
        const selectedItem = adjType === 'Shop' ? shopItems.find((item) => item.id === selectedItemId) : undefined;
        const previousQty = adjType === 'Fuel' ? (selectedTank?.currentLevelLiters ?? 0) : (selectedItem?.stockQty ?? 0);
        const qtyDelta = Number(adjNewQty) - previousQty;
        const unitValue = adjType === 'Fuel' ? getFuelCostPerLiter(selectedTank) : (selectedItem?.costPrice ?? 0);

        await onRecordStockAdjustment({
          type: adjType,
          itemId: selectedItemId,
          newQty: Number(adjNewQty),
          reason: adjReason,
          userId: currentUser?.id,
          userName: currentUser?.name,
          userRole: currentUser?.role,
        });

        const valueDelta = qtyDelta * unitValue;
        setFeedback({
          type: 'success',
          message: `${adjType === 'Fuel' ? 'Fuel volume' : 'Stock quantity'} updated from ${previousQty.toLocaleString()} to ${Number(adjNewQty).toLocaleString()}${adjType === 'Fuel' ? ' L' : ' units'} (${valueDelta >= 0 ? '+' : ''}KES ${valueDelta.toLocaleString('en-KE', { minimumFractionDigits: 2 })}). Adjustment logged!`,
        });
        setShowAdjustmentModal(false);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Stock adjustment failed.' });
    } finally {
      setIsSubmittingAdj(false);
    }
  };

  const openNewItemModal = () => {
    if (!canManageShopItems) return;
    setEditingItem(null);
    setItemName('');
    setItemCategory('Engine Oil');
    setItemTaxCode('A');
    setItemCountry('KE');
    setItemCurrency('KES');
    setItemProductType(1);
    setItemUnit('Pieces');
    setItemCost(1200);
    setItemPrice(1500);
    setItemQty(50);
    setItemReorder(10);
    setShowItemModal(true);
  };
  const deleteShopItem = async () => {
    if (!shopItemToDelete || !onDeleteShopItem) return;
    setDeletingShopItem(true);
    try { await onDeleteShopItem(shopItemToDelete.id); setFeedback({ type: 'success', message: `Shop item '${shopItemToDelete.name}' deleted.` }); setShopItemToDelete(null); }
    catch (err: any) { setFeedback({ type: 'error', message: err.message || 'Failed to delete shop item.' }); setShopItemToDelete(null); }
    finally { setDeletingShopItem(false); }
  };

  const openEditItemModal = (item: ShopItem) => {
    if (!canManageShopItems) return;
    setEditingItem(item);
    setItemName(item.name);
    setItemCategory(item.category || 'Engine Oil');
    setItemTaxCode(item.taxCode || item.taxType || 'A');
    setItemCountry(item.country || 'KE');
    setItemCurrency(item.currency || 'KES');
    setItemProductType(item.productType || 1);
    setItemUnit(item.unit || 'Pieces');
    setItemCost(item.costPrice);
    setItemPrice(item.unitPrice);
    setItemQty(item.stockQty);
    setItemReorder(item.reorderLevel);
    setShowItemModal(true);
  };

  const handleSaveItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) {
      setFeedback({ type: 'error', message: 'Item name is required.' });
      return;
    }
    if (!itemTaxCode) {
      setFeedback({ type: 'error', message: 'Tax code is required.' });
      return;
    }

    setIsSubmittingItem(true);
    setFeedback(null);
    try {
      const payload = {
        id: editingItem?.id,
        name: itemName,
        category: itemCategory,
        costPrice: Number(itemCost),
        unitPrice: Number(itemPrice),
        price: Number(itemPrice),
        stockQty: Number(itemQty),
        reorderLevel: Number(itemReorder),
        taxCode: itemTaxCode,
        taxType: itemTaxCode,
        country: itemCountry,
        currency: itemCurrency,
        productType: itemProductType,
        unit: itemUnit,
        userId: currentUser?.id,
        userName: currentUser?.name,
        userRole: currentUser?.role,
      };

      if (editingItem && onUpdateShopItem) {
        await onUpdateShopItem(editingItem.id, payload);
        setFeedback({ type: 'success', message: `Shop item '${itemName}' updated.` });
      } else if (onSaveShopItem) {
        await onSaveShopItem(payload);
        setFeedback({ type: 'success', message: `Shop item '${itemName}' saved.` });
      }
      setShowItemModal(false);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save shop item.' });
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const filteredShopItems = shopItems.filter((item) => {
    const q = searchTerm.toLowerCase();
    return item.name.toLowerCase().includes(q) || (item.category && item.category.toLowerCase().includes(q));
  });
  const shopItemPagination = usePagination(filteredShopItems, `shop-items:${searchTerm.trim().toLowerCase()}`);

  useEffect(() => {
    if (activeTab !== 'adjustments') return;
    let cancelled = false;
    setAdjustmentsLoading(true);
    setAdjustmentsError(null);
    api.getStockAdjustmentPage(adjustmentPage, STOCK_AUDIT_PAGE_SIZE)
      .then((result) => {
        if (cancelled) return;
        setRemoteAdjustments(result.records);
        setAdjustmentTotal(result.total);
        setAdjustmentTotalPages(result.totalPages);
      })
      .catch((error: Error) => { if (!cancelled) setAdjustmentsError(error.message || 'Unable to load stock audit records.'); })
      .finally(() => { if (!cancelled) setAdjustmentsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, adjustmentPage, adjustments.length]);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900/90 border border-slate-800 p-6 rounded-2xl shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Package className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-black text-slate-100 tracking-tight">Stock & Inventory Audit</h1>
          </div>
          <p className="text-xs text-slate-400">
            Real-time tracking of underground tank volumes, shop retail inventory, reorder point alerts, and audit adjustments.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {canAdjustStock && (
            <button
              onClick={() => openAdjustmentModalFor('Shop')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-all border border-slate-700 flex items-center gap-2"
            >
              <Scale className="w-4 h-4 text-amber-400" />
              Audit Stock Adjustment
            </button>
          )}
          {canManageShopItems && (
            <button
              onClick={openNewItemModal}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all shadow-lg shadow-emerald-950/40 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add New Shop Item
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs font-semibold ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Stock Valuation</div>
          <div className="text-2xl font-black text-emerald-400 font-mono mt-2">
            KES {(fuelStockValuation + shopStockValuation).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Fuel Storage + Shop Products Asset Value</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Fuel Tank Volume</div>
          <div className="text-2xl font-black text-slate-100 font-mono mt-2">
            {fuelVolumeTotal.toLocaleString('en-KE', { maximumFractionDigits: 0 })} L
          </div>
          <p className="text-[11px] text-emerald-400 mt-1">
            Valued at KES {fuelStockValuation.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          {fuelProductTotals.length > 0 && (
            <div className="mt-2 space-y-1 text-[10px] text-slate-300">
              {fuelProductTotals.map(({ product, liters, value }) => (
                <div key={product.id} className="flex items-center justify-between gap-2">
                  <span>{product.name}</span>
                  <span className="font-mono text-slate-100">{liters.toLocaleString('en-KE', { maximumFractionDigits: 0 })} L</span>
                  <span className="font-mono text-emerald-400">KES {value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Shop Retail Stock</div>
          <div className="text-2xl font-black text-slate-100 font-mono mt-2">{shopItems.reduce((s, i) => s + i.stockQty, 0)} Units</div>
          <p className="text-[11px] text-slate-400 mt-1">{shopItems.length} Products registered across shop</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Low Stock Reorder Alerts</div>
          <div className={`text-2xl font-black font-mono mt-2 ${lowStockShopCount + lowStockTankCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {lowStockShopCount + lowStockTankCount} Items
          </div>
          <p className="text-[11px] text-amber-400 mt-1">Requires procurement / refill order</p>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'overview'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            Stock Overview & Fuel Tanks ({tanks.length})
          </button>
          <button
            onClick={() => setActiveTab('shop-items')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'shop-items'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            Shop Inventory ({shopItems.length})
          </button>
          <button
            onClick={() => setActiveTab('adjustments')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeTab === 'adjustments'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <History className="w-4 h-4" />
            Stock Adjustments Audit Log ({adjustments.length})
          </button>
        </div>

        {activeTab === 'shop-items' && (
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filter shop items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}
      </div>

      {/* Tab 1: Overview & Tanks */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <Fuel className="w-4 h-4 text-emerald-400" />
              Underground Fuel Tanks Storage & Dip Volumes
            </h3>
            <span className="text-[11px] text-slate-500">Fuel balances are managed in Pumps &amp; Tanks.</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {tanks.map((tank) => {
              const pct = Math.round((tank.currentLevelLiters / tank.capacityLiters) * 100);
              const isReorder = tank.currentLevelLiters <= tank.reorderLevelLiters;
              const tankValue = getTankValue(tank, tank.currentLevelLiters);

              return (
                <div key={tank.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl relative overflow-hidden">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm">{tank.tankName}</h4>
                      <p className="text-xs text-slate-400">{tank.fuelName}</p>
                    </div>
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                        isReorder
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      {isReorder ? 'REORDER ALERT' : 'Normal Volume'}
                    </span>
                  </div>

                  <div className="space-y-1.5 font-mono">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Current Volume:</span>
                      <span className="font-bold text-slate-100">
                        {tank.currentLevelLiters.toLocaleString()} / {tank.capacityLiters.toLocaleString()} L
                      </span>
                    </div>

                    <div className="h-4 bg-slate-950 rounded-full border border-slate-800 p-0.5 overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isReorder ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-200 drop-shadow">
                        {pct}% Capacity
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800 gap-2">
                    <div className="text-slate-400 text-[11px] space-y-1">
                      <div>
                        Reorder Threshold: <strong className="text-slate-200">{tank.reorderLevelLiters.toLocaleString()} L</strong>
                      </div>
                      <div>
                        Value: <strong className="text-emerald-400">KES {tankValue.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</strong>
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}

            {tanks.length === 0 && (
              <div className="col-span-full bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
                <Fuel className="w-10 h-10 text-slate-600 mx-auto" />
                <h4 className="text-slate-200 font-bold text-sm">No Underground Tanks Registered</h4>
                <p className="text-xs text-slate-400">Zero pumps/tanks configured. Use 'Pumps & Tanks' tab to register station tanks.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Shop Inventory Table */}
      {activeTab === 'shop-items' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-emerald-400" />
              Shop Retail Items Stock Catalog
            </h3>
            <span className="text-xs font-mono text-slate-400">{filteredShopItems.length} Products</span>
          </div>

          <div className="overflow-x-auto">
            <table className="fms-table min-w-[760px] text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Cost Price</th>
                  <th className="py-3 px-4 text-right">Retail Price</th>
                  <th className="py-3 px-4 text-right">Stock Qty</th>
                  <th className="py-3 px-4 text-right">Reorder Point</th>
                  <th className="py-3 px-4">Stock Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {shopItemPagination.pageItems.map((item) => {
                  const isLow = item.stockQty <= item.reorderLevel;
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-100 font-sans">{item.name}</td>
                      <td className="py-3 px-4 text-slate-400 font-sans">{item.category || 'General'}</td>
                      <td className="py-3 px-4 text-right text-slate-400">KES {item.costPrice.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-400">KES {item.unitPrice.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right font-extrabold text-slate-100">{item.stockQty}</td>
                      <td className="py-3 px-4 text-right text-slate-500">{item.reorderLevel}</td>
                      <td className="py-3 px-4 font-sans">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border ${
                            isLow
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          }`}
                        >
                          {isLow ? 'LOW STOCK' : 'IN STOCK'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-sans space-x-2">
                        {canAdjustStock && (
                          <button
                            onClick={() => openAdjustmentModalFor('Shop', item)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-400 font-semibold rounded-lg border border-slate-700 text-[11px]"
                          >
                            Adjust Qty
                          </button>
                        )}
                        {canManageShopItems && (
                          <>
                            <button
                              onClick={() => openEditItemModal(item)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg border border-slate-700 text-[11px]"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setShopItemToDelete(item)}
                              className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-semibold rounded-lg border border-rose-500/20 text-[11px]"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {filteredShopItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                      No shop items registered yet. Click 'Add New Shop Item' to add items.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <PaginationControls
              currentPage={shopItemPagination.currentPage}
              totalPages={shopItemPagination.totalPages}
              itemCount={filteredShopItems.length}
              onPageChange={shopItemPagination.setCurrentPage}
            />
          </div>
        </div>
      )}

      {/* Tab 3: Stock Adjustment Audit History */}
      {activeTab === 'adjustments' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-400" />
              Stock Audit & Adjustment Logs
            </h3>
            <span className="text-xs font-mono text-slate-400">{adjustmentTotal} Records</span>
          </div>

          <div className="overflow-x-auto">
            <table className="fms-table min-w-[760px] text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Tank / Product</th>
                  <th className="py-3 px-4">Movement</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4 text-right">Qty Change</th>
                  <th className="py-3 px-4 text-right">Previous → New</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {!adjustmentsLoading && !adjustmentsError && remoteAdjustments.map((adj) => {
                  const isNeg = adj.differenceQty < 0;
                  const fuelTank = adj.type === 'Fuel' ? tanks.find((tank) => tank.id === adj.itemId) : undefined;
                  const quantityUnit = adj.type === 'Fuel' ? ' L' : '';
                  const movementType = adj.movementType || (adj.differenceQty > 0 ? 'Stock Increase' : adj.differenceQty < 0 ? 'Stock Decrease' : 'No Change');
                  const movementLabel = movementType === 'SALE' ? 'Fuel Sale' : movementType;
                  const isStockDecrease = movementType === 'Stock Decrease' || movementType === 'SALE';
                  const source = adj.source || 'Manual Adjustment';
                  const isRttReturn = source === 'Credit Note RTT' || adj.reason === 'Credit Note RTT Return to Tank';
                  const reasonLabel = isRttReturn ? 'Credit Note RTT - Return to Tank' : adj.reason;
                  const reference = adj.referenceNumber || adj.originalDocumentNumber || '—';
                  const performedBy = adj.performedBy || adj.recordedBy || 'System';
                  const valueDelta = getAdjustmentValue(adj);
                  return (
                    <tr key={adj.id} className="hover:bg-slate-800/40 transition-colors align-top">
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">{formatAuditTimestamp(adj.timestamp)}</td>
                      <td className="py-3 px-4 font-bold text-slate-100 font-sans">
                        <div>{adj.type === 'Fuel' ? 'Tank: ' + adj.itemName : adj.itemName}</div>
                        {adj.type === 'Fuel' && <div className="text-[10px] text-slate-400">Fuel: {fuelTank?.fuelName || adj.itemCode || 'Unmapped product'}</div>}
                        {adj.itemCode && <div className="text-[10px] text-slate-500">{adj.itemCode}</div>}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            isStockDecrease ? 'bg-rose-500/10 text-rose-400' :
                            movementType === 'No Change' ? 'bg-slate-500/10 text-slate-300' :
                            movementType === 'Stock Return' ? 'bg-emerald-500/10 text-emerald-400' :
                            adj.type === 'Fuel' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                          }`}
                        >
                          {movementLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-300 max-w-[180px]">
                        <div>{reasonLabel}</div>
                        {!isRttReturn && (
                          <div className="mt-1 text-[10px] text-slate-400">
                            {adj.type === 'Fuel' ? 'Fuel value' : 'Stock value'}: <span className={valueDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>KES {Math.abs(valueDelta).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-bold">
                        <span className={isNeg ? 'text-rose-400' : 'text-emerald-400'}>{(adj.differenceQty > 0 ? '+' : '') + adj.differenceQty + quantityUnit}</span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300 whitespace-nowrap">{adj.previousQty}{quantityUnit} to {adj.adjustedQty}{quantityUnit}</td>
                      <td className="py-3 px-4 font-sans text-slate-400">{source}</td>
                      <td className="py-3 px-4 font-sans text-slate-400 break-all">{reference}</td>
                      <td className="py-3 px-4 font-sans text-slate-400">{performedBy}</td>
                    </tr>
                  );
                })}

                {adjustmentsLoading && (
                  <tr><td colSpan={9} className="py-8 text-center text-slate-400 font-sans">Loading stock audit records...</td></tr>
                )}
                {adjustmentsError && (
                  <tr><td colSpan={9} className="py-8 text-center text-rose-300 font-sans">Unable to load stock audit records.</td></tr>
                )}
                {!adjustmentsLoading && !adjustmentsError && remoteAdjustments.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500 font-sans">No stock audit records found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <PaginationControls
              currentPage={adjustmentPage}
              totalPages={adjustmentTotalPages}
              itemCount={adjustmentTotal}
              pageSize={STOCK_AUDIT_PAGE_SIZE}
              onPageChange={setAdjustmentPage}
            />
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {showAdjustmentModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-slate-100 text-base">Record Stock Audit Adjustment</h3>
              </div>
              <button onClick={() => setShowAdjustmentModal(false)} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustmentSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Target Category</label>
                  <select
                    value={adjType}
                    onChange={(e) => {
                      const t = e.target.value as 'Fuel' | 'Shop';
                      setAdjType(t);
                      if (t === 'Fuel') {
                        setSelectedItemId(tanks[0]?.id || '');
                        setAdjNewQty(tanks[0]?.currentLevelLiters || 0);
                      } else {
                        setSelectedItemId(shopItems[0]?.id || '');
                        setAdjNewQty(shopItems[0]?.stockQty || 0);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                  >
                    <option value="Shop">Shop Retail Product</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1">Item / Tank</label>
                  <select
                    value={selectedItemId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedItemId(id);
                      if (adjType === 'Fuel') {
                        const tk = tanks.find((t) => t.id === id);
                        if (tk) setAdjNewQty(tk.currentLevelLiters);
                      } else {
                        const sh = shopItems.find((s) => s.id === id);
                        if (sh) setAdjNewQty(sh.stockQty);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                  >
                    {adjType === 'Fuel'
                      ? tanks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.tankName} ({t.currentLevelLiters} L)
                          </option>
                        ))
                      : shopItems.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.stockQty} in stock)
                          </option>
                        ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">New Audited Stock Quantity *</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={adjNewQty}
                  onChange={(e) => setAdjNewQty(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold text-base focus:outline-none focus:border-emerald-500"
                />
              </div>

              {(adjType === 'Fuel' && selectedItemId) && (() => {
                const tank = tanks.find((entry) => entry.id === selectedItemId);
                const costPerLiter = getFuelCostPerLiter(tank);
                const quantityValue = Number(adjNewQty) * costPerLiter;
                const previousValue = (tank?.currentLevelLiters ?? 0) * costPerLiter;
                const deltaValue = quantityValue - previousValue;
                return (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-[11px] text-slate-300 space-y-1">
                    <div className="flex justify-between"><span>Unit Cost:</span><span className="text-emerald-400">KES {costPerLiter.toLocaleString('en-KE', { minimumFractionDigits: 2 })}/L</span></div>
                    <div className="flex justify-between"><span>Audited Volume:</span><span className="text-slate-100">{Number(adjNewQty).toLocaleString()} L</span></div>
                    <div className="flex justify-between"><span>Audited Value:</span><span className="text-emerald-400">KES {quantityValue.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between"><span>Value Delta:</span><span className={deltaValue >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{deltaValue >= 0 ? '+' : ''}KES {deltaValue.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span></div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-slate-400 font-bold mb-1">Audit Adjustment Reason *</label>
                <select
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                >
                  <option value="Stock Take Audit">Stock Take Audit / Count Verification</option>
                  <option value="Damage/Spill">Damage / Spill / Evaporation</option>
                  <option value="Calibration">Tank Gauge / Meter Calibration</option>
                  <option value="Theft/Loss">Unexplained Theft / Loss Discrepancy</option>
                  <option value="Initial Count">Initial Baseline Setup</option>
                  <option value="Restock">Restock</option>
                  <option value="Other">Other Operational Adjustment</option>
                </select>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdjustmentModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdj}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all flex items-center gap-2"
                >
                  {isSubmittingAdj ? 'Saving...' : 'Save Stock Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Shop Item Modal */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-slate-100 text-base">{editingItem ? 'Edit Shop Retail Item' : 'Add New Shop Retail Item'}</h3>
              </div>
              <button onClick={() => setShowItemModal(false)} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItemSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-bold mb-1">Product Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Helix Ultra 5W-40 Synthetic (4L)"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Category</label>
                <select
                  value={itemCategory}
                  onChange={(e) => setItemCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                >
                  <option value="Engine Oil">Engine Oil & Lubricants</option>
                  <option value="Car Care">Car Care & Fluids</option>
                  <option value="Beverages">Beverages & Drinks</option>
                  <option value="Snacks">Snacks & Confectionery</option>
                  <option value="Auto Accessories">Auto Accessories</option>
                  <option value="Gas Cylinder">LPG Cooking Gas Cylinder</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Country</label>
                  <select
                    value={itemCountry}
                    onChange={(e) => setItemCountry(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
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
                  <label className="block text-slate-400 font-bold mb-1">Currency</label>
                  <select
                    value={itemCurrency}
                    onChange={(e) => setItemCurrency(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
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
                  <label className="block text-slate-400 font-bold mb-1">Tax Type</label>
                  <select
                    value={itemTaxCode}
                    onChange={(e) => setItemTaxCode(e.target.value as 'A' | 'B' | 'C' | 'D' | 'E')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                  >
                    <option value="A">A — EXEMPT GOODS/SERVICES == 0%</option>
                    <option value="B">B — VAT Act — 16%</option>
                    <option value="C">C — ZERO RATED — 0%</option>
                    <option value="D">D — NON-VAT — 0%</option>
                    <option value="E">E — SPECIAL RATE — 8%</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Product Type</label>
                  <select
                    value={itemProductType}
                    onChange={(e) => setItemProductType(Number(e.target.value) as 1 | 2 | 3)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
                  >
                    <option value={1}>1 – Raw material</option>
                    <option value={2}>2 – Finished goods</option>
                    <option value={3}>3 – Services</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Unit</label>
                  <select
                    value={itemUnit}
                    onChange={(e) => setItemUnit(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-semibold"
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
                  <label className="block text-slate-400 font-bold mb-1">Current Stock Qty</label>
                  <input
                    type="number"
                    min={0}
                    value={itemQty}
                    onChange={(e) => setItemQty(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Wholesale Cost</label>
                  <input
                    type="number"
                    min={0}
                    value={itemCost}
                    onChange={(e) => setItemCost(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1">Retail Price *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={itemPrice}
                    onChange={(e) => setItemPrice(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Reorder Point Alert</label>
                <input
                  type="number"
                  min={0}
                  value={itemReorder}
                  onChange={(e) => setItemReorder(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingItem}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all flex items-center gap-2"
                >
                  {isSubmittingItem ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <AppDialog open={Boolean(shopItemToDelete)} kind="delete" title="Delete shop item" message={`Delete ${shopItemToDelete?.name || 'this item'}? This action cannot be undone.`} busy={deletingShopItem} onClose={() => setShopItemToDelete(null)} onConfirm={deleteShopItem} />
    </div>
  );
};
