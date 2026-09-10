import React, { useState, useEffect } from 'react';
import {
  Fuel,
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  PhoneCall,
  DollarSign,
  Building2,
  Car,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  QrCode,
  Sparkles,
  Flame,
  Droplet,
  PackageCheck,
  Zap,
} from 'lucide-react';
import {
  FuelProduct,
  PumpNozzle,
  ShopItem,
  ShiftSession,
  StationSettings,
  User,
  Transaction,
  PaymentMethod,
  CustomerAccount,
  TAX_RATE_BY_TYPE,
  TaxCode,
} from '../types';
import { PaginationControls, usePagination } from './PaginationControls';
import { computeDocumentTotals } from '../utils/documentTotals';

interface PointOfSaleProps {
  products: FuelProduct[];
  pumps: PumpNozzle[];
  shopItems: ShopItem[];
  shifts: ShiftSession[];
  customers?: CustomerAccount[];
  currentUser: User;
  stationSettings?: StationSettings | null;
  onProcessSale: (saleData: any) => Promise<Transaction>;
  onOpenClockInModal: () => void;
  onOpenReceipt: (tx: Transaction) => void;
  onSaveCustomer?: (customerData: any) => Promise<any>;
}

export interface CartItem {
  id: string;
  itemId: string;
  name: string;
  type: 'Fuel' | 'Shop';
  qty: number;
  unitPrice: number; // VAT‑INCLUSIVE price
  pumpId?: string;
  nozzleId?: string;
  category?: string;
  taxCode?: TaxCode;
  taxRate?: number;
}

export const PointOfSale: React.FC<PointOfSaleProps> = ({
  products = [],
  pumps = [],
  shopItems = [],
  shifts = [],
  customers = [],
  currentUser,
  stationSettings,
  onProcessSale,
  onOpenClockInModal,
  onOpenReceipt,
  onSaveCustomer,
}) => {
  // Check if current user is clocked in
  const activeShift = (shifts || []).find(
    (s) => s.staffId === currentUser?.id && s.status === 'Active'
  );

  // Terminal Tab Selection
  const [activeTabCategory, setActiveTabCategory] = useState<string>('Piped Fuel');

  // Fuel POS State
  const fallbackProduct: FuelProduct = {
    id: 'prod-1',
    code: 'PET-UNL',
    name: 'Super Petrol UNL 95',
    pricePerLiter: 188.50,
    costPerLiter: 165.00,
    taxRate: 0.16,
    taxCode: 'B',
    unit: 'L',
    color: 'emerald',
  };

  const [selectedProduct, setSelectedProduct] = useState<FuelProduct>(products[0] || fallbackProduct);
  const [selectedPump, setSelectedPump] = useState<PumpNozzle | null>(null);

  useEffect(() => {
    if (!products.length) return;
    setSelectedProduct((current) => {
      const active = current && products.some((product) => product.id === current.id)
        ? products.find((product) => product.id === current.id)!
        : products[0];
      return active || current || products[0] || fallbackProduct;
    });
  }, [products]);

  const compatiblePumps = pumps.filter((pump) => pump.fuelProductId === selectedProduct.id);

  const handleSelectFuelProduct = (product: FuelProduct) => {
    setSelectedProduct(product);
    setFuelAmountKes(Number((fuelQtyLiters * product.pricePerLiter).toFixed(2)));

    if (selectedPump && selectedPump.fuelProductId !== product.id) {
      setSelectedPump(null);
    }
  };

  const [fuelQtyLiters, setFuelQtyLiters] = useState<number>(20);
  const [fuelAmountKes, setFuelAmountKes] = useState<number>(
    20 * (products[0]?.pricePerLiter || 188.50)
  );

  // Customer / Vehicle Info
  const [customerName, setCustomerName] = useState<string>('');
  const [vehiclePlate, setVehiclePlate] = useState<string>('');
  const [customerPin, setCustomerPin] = useState<string>('');
  const [customerSearchTerm, setCustomerSearchTerm] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState('');
  const [quickCustomerPin, setQuickCustomerPin] = useState('');
  const [quickCustomerPhone, setQuickCustomerPhone] = useState('');
  const [quickCustomerEmail, setQuickCustomerEmail] = useState('');
  const [quickCustomerAddress, setQuickCustomerAddress] = useState('');
  const [quickCustomerLimit, setQuickCustomerLimit] = useState(100000);
  const [quickCustomerVehicles, setQuickCustomerVehicles] = useState('');
  const [isSavingQuickCustomer, setIsSavingQuickCustomer] = useState(false);

  // Unified Order Cart State
  const [unifiedCart, setUnifiedCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Payment State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('M-Pesa');
  const [documentType, setDocumentType] = useState<'Receipt' | 'Invoice'>('Receipt');
  const [paymentRef, setPaymentRef] = useState<string>('');
  const [mpesaPhoneNumber, setMpesaPhoneNumber] = useState<string>('+254712345678');
  const [stkPushSimulating, setStkPushSimulating] = useState<boolean>(false);
  const [stkPushSuccess, setStkPushSuccess] = useState<boolean>(false);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Sync Fuel Amount vs Liters
  const handleLitersChange = (liters: number) => {
    const l = Math.max(0.1, liters);
    setFuelQtyLiters(l);
    setFuelAmountKes(Number((l * selectedProduct.pricePerLiter).toFixed(2)));
  };

  const handleAmountChange = (amount: number) => {
    const a = Math.max(10, amount);
    setFuelAmountKes(a);
    setFuelQtyLiters(Number((a / selectedProduct.pricePerLiter).toFixed(2)));
  };

  const handlePresetAmount = (amount: number) => {
    handleAmountChange(amount);
  };

  // Add Fuel Dispense directly into Unified Cart
  const normalizeTaxCode = (value: string | number | undefined): TaxCode => {
    const candidate = String(value ?? 'B').toUpperCase();
    const allowed: TaxCode[] = ['A', 'B', 'C', 'D', 'E'];
    if (candidate === '0.08' || candidate === '0.16') {
      return candidate === '0.08' ? 'E' : 'B';
    }
    return allowed.includes(candidate as TaxCode) ? (candidate as TaxCode) : 'B';
  };

  const handleAddFuelToCart = () => {
    if (!selectedPump) {
      return;
    }

    if (selectedProduct.id !== selectedPump.fuelProductId) {
      const matchingProduct = products.find((product) => product.id === selectedPump.fuelProductId);
      if (matchingProduct) {
        setSelectedProduct(matchingProduct);
      }
      return;
    }

    const fuelTaxCode = normalizeTaxCode(selectedProduct.taxCode || selectedProduct.taxRate || 'B') as TaxCode;
    const fuelItem: CartItem = {
      id: `fuel-${selectedProduct.id}-${selectedPump.id}-${Date.now()}`,
      itemId: selectedProduct.id,
      name: selectedProduct.name,
      type: 'Fuel',
      qty: Number(fuelQtyLiters.toFixed(2)),
      unitPrice: selectedProduct.pricePerLiter, // VAT‑inclusive
      pumpId: selectedPump.id,
      nozzleId: selectedPump.id,
      category: 'Piped Fuel',
      taxCode: fuelTaxCode,
      taxRate: Number(selectedProduct.taxRate ?? TAX_RATE_BY_TYPE[fuelTaxCode] ?? 0.16),
    };

    setUnifiedCart((prev) => {
      const existingIdx = prev.findIndex(
        (i) => i.type === 'Fuel' && i.itemId === selectedProduct.id && i.pumpId === selectedPump.id
      );
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = fuelItem;
        return updated;
      }
      return [...prev, fuelItem];
    });
  };

  // Shop / Fuel Product Cart Handlers
  const addShopItemToCart = (item: ShopItem) => {
    setUnifiedCart((prev) => {
      const existing = prev.find((i) => i.itemId === item.id);
      if (existing) {
        return prev.map((i) =>
          i.itemId === item.id ? { ...i, qty: i.qty + 1 } : i
        );
      }
      const shopTaxCode = normalizeTaxCode((item.taxCode ?? item.taxType ?? 'A')) as TaxCode;
      return [
        ...prev,
        {
          id: `shp-${item.id}`,
          itemId: item.id,
          name: item.name,
          type: 'Shop',
          qty: 1,
          unitPrice: item.unitPrice, // VAT‑inclusive
          category: item.category,
          taxCode: shopTaxCode,
          taxRate: Number((item as any).taxRate ?? TAX_RATE_BY_TYPE[shopTaxCode] ?? 0),
        },
      ];
    });
  };

  const updateCartQty = (id: string, delta: number) => {
    setUnifiedCart((prev) =>
      prev
        .map((i) => {
          if (i.id === id) {
            const newQty = i.qty + delta;
            return newQty > 0 ? { ...i, qty: Number(newQty.toFixed(2)) } : null;
          }
          return i;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (id: string) => {
    setUnifiedCart((prev) => prev.filter((i) => i.id !== id));
  };

  // M-Pesa STK Push Simulation
  const handleSimulateStkPush = () => {
    setStkPushSimulating(true);
    setStkPushSuccess(false);
    setTimeout(() => {
      setStkPushSimulating(false);
      setStkPushSuccess(true);
      setPaymentRef(`MP${Math.random().toString(36).substring(2, 9).toUpperCase()}`);
    }, 1500);
  };

  // ------------------------------------------------------------
  // COMPUTE TOTALS – unitPrice is VAT‑INCLUSIVE
  // ------------------------------------------------------------
  const computeCartTotals = (items: CartItem[]) => {
    let subtotalExclTax = 0;
    let totalTax = 0;

    items.forEach((item) => {
      const lineTotalIncl = item.unitPrice * item.qty;
      const rate = item.taxRate ?? 0;

      let lineTotalExcl = lineTotalIncl;
      let lineTax = 0;

      if (rate > 0) {
        // Reverse‑calculate VAT from inclusive price
        lineTotalExcl = lineTotalIncl / (1 + rate);
        lineTax = lineTotalIncl - lineTotalExcl;
      }

      subtotalExclTax += lineTotalExcl;
      totalTax += lineTax;
    });

    return {
      subtotalExclTax,
      totalTax,
      totalPayable: subtotalExclTax + totalTax, // equals sum of all lineTotalIncl
    };
  };

  const { subtotalExclTax, totalTax, totalPayable } = computeCartTotals(unifiedCart);
  // ------------------------------------------------------------

  const matchingCustomers = customers.filter((cust) => {
    const query = customerSearchTerm.trim().toLowerCase();
    if (!query) return false;
    return (
      cust.name.toLowerCase().includes(query) ||
      (cust.kraPin && cust.kraPin.toLowerCase().includes(query)) ||
      cust.phone.toLowerCase().includes(query) ||
      (cust.vehicles || []).some((plate) => plate.toLowerCase().includes(query))
    );
  });

  const matchedCustomer = selectedCustomerId
    ? customers.find((cust) => cust.id === selectedCustomerId) || customers.find(
        (cust) =>
          (customerPin && cust.kraPin?.toLowerCase() === customerPin.toLowerCase()) ||
          (customerName && cust.name.toLowerCase() === customerName.toLowerCase()) ||
          (vehiclePlate && (cust.vehicles || []).some((plate) => plate.replace(/\s+/g, '').toLowerCase() === vehiclePlate.replace(/\s+/g, '').toLowerCase()))
      )
    : customers.find(
        (cust) =>
          (customerPin && cust.kraPin?.toLowerCase() === customerPin.toLowerCase()) ||
          (customerName && cust.name.toLowerCase() === customerName.toLowerCase()) ||
          (vehiclePlate && (cust.vehicles || []).some((plate) => plate.replace(/\s+/g, '').toLowerCase() === vehiclePlate.replace(/\s+/g, '').toLowerCase()))
      );

  const availableCredit = matchedCustomer ? Math.max(0, matchedCustomer.creditLimit - matchedCustomer.currentBalance) : 0;
  const canIssueCreditInvoice = paymentMethod === 'Credit' && !!matchedCustomer && matchedCustomer.status === 'Active' && availableCredit >= totalPayable;

  React.useEffect(() => {
    if (paymentMethod === 'Credit') {
      setDocumentType(canIssueCreditInvoice ? documentType === 'Invoice' || documentType === 'Receipt' ? documentType : 'Receipt' : 'Receipt');
    } else {
      setDocumentType('Receipt');
    }
  }, [paymentMethod, canIssueCreditInvoice]);

  // Transaction classification
  const hasFuel = unifiedCart.some((i) => i.type === 'Fuel');
  const hasShop = unifiedCart.some((i) => i.type === 'Shop');
  const saleTxType: 'Fuel' | 'Shop' | 'Combined' =
    hasFuel && hasShop ? 'Combined' : hasFuel ? 'Fuel' : 'Shop';

  // Instant Express Quick Fuel Sale
  const handleExpressFuelSale = async () => {
    if (!activeShift) return;
    if (!selectedPump) return;
    if (selectedPump && selectedProduct.id !== selectedPump.fuelProductId) {
      const matchingProduct = products.find((product) => product.id === selectedPump.fuelProductId);
      if (matchingProduct) {
        setSelectedProduct(matchingProduct);
      }
      return;
    }
    setIsSubmitting(true);
    try {
      const fuelTaxCode = normalizeTaxCode(selectedProduct.taxCode || selectedProduct.taxRate || 'B') as TaxCode;
      const expressSalePayload = {
        shiftId: activeShift.id,
        staffId: currentUser.id,
        staffName: currentUser.name,
        type: 'Fuel',
        items: [
          {
            itemId: selectedProduct.id,
            pumpId: selectedPump ? selectedPump.id : 'default-pump',
            nozzleId: selectedPump ? selectedPump.id : 'default-pump',
            name: selectedProduct.name,
            type: 'Fuel',
            qty: fuelQtyLiters,
            unitPrice: selectedProduct.pricePerLiter,
            taxCode: fuelTaxCode,
            taxRate: Number(selectedProduct.taxRate ?? TAX_RATE_BY_TYPE[fuelTaxCode] ?? 0.16),
          },
        ],
        paymentMethod,
        paymentRef: paymentRef || undefined,
        customerName: customerName || undefined,
        vehiclePlate: vehiclePlate ? vehiclePlate.toUpperCase() : undefined,
        customerPin: customerPin ? customerPin.toUpperCase() : undefined,
      };

      const newTx = await onProcessSale(expressSalePayload);

      setCustomerName('');
      setVehiclePlate('');
      setCustomerPin('');
      setPaymentRef('');
      setStkPushSuccess(false);

      onOpenReceipt(newTx);
    } catch (err) {
      console.error('Failed express fuel sale:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Unified Cart Checkout Submission
  const handleQuickCustomerSelect = (cust: CustomerAccount) => {
    setSelectedCustomerId(cust.id);
    setCustomerName(cust.name);
    setCustomerPin(cust.kraPin || '');
    if ((cust.vehicles || []).length > 0) {
      setVehiclePlate(cust.vehicles[0]);
    }
    setCustomerSearchTerm('');
  };

  const handleQuickCustomerSave = async () => {
    if (!onSaveCustomer) return;
    if (!quickCustomerName.trim() || !quickCustomerPin.trim() || !quickCustomerPhone.trim()) {
      return;
    }

    setIsSavingQuickCustomer(true);
    try {
      const savedCustomer = await onSaveCustomer({
        name: quickCustomerName.trim(),
        kraPin: quickCustomerPin.trim().toUpperCase(),
        phone: quickCustomerPhone.trim(),
        email: quickCustomerEmail.trim(),
        address: quickCustomerAddress.trim(),
        creditLimit: Number(quickCustomerLimit || 0),
        vehicles: quickCustomerVehicles
          .split(',')
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean),
        status: 'Active',
      });

      setSelectedCustomerId(savedCustomer?.id || null);
      setCustomerName(savedCustomer?.name || quickCustomerName.trim());
      setCustomerPin(savedCustomer?.kraPin || quickCustomerPin.trim().toUpperCase());
      setVehiclePlate((savedCustomer?.vehicles && savedCustomer.vehicles[0]) || quickCustomerVehicles.split(',')[0]?.trim().toUpperCase() || '');
      setQuickCustomerName('');
      setQuickCustomerPin('');
      setQuickCustomerPhone('');
      setQuickCustomerEmail('');
      setQuickCustomerAddress('');
      setQuickCustomerLimit(100000);
      setQuickCustomerVehicles('');
      setShowQuickAddCustomer(false);
    } finally {
      setIsSavingQuickCustomer(false);
    }
  };

  const buildCartSalePayload = () => {
    const itemsToSubmit = unifiedCart.map((item) => ({
      itemId: item.itemId,
      pumpId: item.pumpId,
      nozzleId: item.nozzleId || item.pumpId,
      name: item.name,
      type: item.type,
      qty: item.qty,
      unitPrice: item.unitPrice,
      taxCode: normalizeTaxCode(item.taxCode ?? (item.type === 'Fuel' ? 'B' : 'A')),
      taxRate: Number(item.taxRate ?? (item.type === 'Fuel' ? TAX_RATE_BY_TYPE.B : TAX_RATE_BY_TYPE.A)),
    }));

    return {
      shiftId: activeShift?.id,
      staffId: currentUser.id,
      staffName: currentUser.name,
      type: saleTxType,
      items: itemsToSubmit,
      paymentMethod,
      paymentRef: paymentRef || undefined,
      customerName: customerName || undefined,
      vehiclePlate: vehiclePlate ? vehiclePlate.toUpperCase() : undefined,
      customerPin: customerPin ? customerPin.toUpperCase() : undefined,
      documentType,
    };
  };

  const handleCartCheckout = async () => {
    if (!activeShift) return;
    if (unifiedCart.length === 0 || totalPayable <= 0) return;

    if (paymentMethod === 'Credit' && !canIssueCreditInvoice && !matchedCustomer) {
      setDocumentType('Receipt');
    }

    const basePayload = buildCartSalePayload();
    const salePayload = {
      ...basePayload,
      documentType: paymentMethod === 'Credit' && !canIssueCreditInvoice && !matchedCustomer
        ? 'Receipt' as const
        : basePayload.documentType,
    };
    setIsSubmitting(true);
    try {
      const newTx = await onProcessSale(salePayload);

      setCustomerName('');
      setVehiclePlate('');
      setCustomerPin('');
      setUnifiedCart([]);
      setPaymentRef('');
      setStkPushSuccess(false);

      onOpenReceipt(newTx);
    } catch (err) {
      console.error('Failed cart checkout:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter Shop Items
  const filteredShopItems = shopItems.filter((i) => {
    const matchesSearch =
      i.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.code.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (activeTabCategory === 'Piped Fuel') return true;
    if (activeTabCategory === 'All Catalog') return true;
    if (activeTabCategory === 'Lubricants & Oils') return i.category === 'Lubricants';
    if (activeTabCategory === 'Gas Cylinders') return i.category === 'Gas Cylinders';
    if (activeTabCategory === 'Coolants & Care') return i.category === 'Car Care';
    if (activeTabCategory === 'Snacks & Drinks') return i.category === 'Snacks & Drinks';
    if (activeTabCategory === 'Car Accessories') return i.category === 'General';

    return true;
  });

  const topFuelProducts = (shopItems || []).filter((i) =>
    ['Lubricants', 'Gas Cylinders', 'Car Care'].includes(i.category)
  ).slice(0, 4);
  const catalogPagination = usePagination(
    filteredShopItems,
    `${activeTabCategory}:${searchTerm.trim().toLowerCase()}`,
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Clock-in Guard */}
      {!activeShift && (
        <div className="fms-pos-clockin-alert flex flex-col items-center justify-between gap-4 rounded-2xl p-6 shadow-xl md:flex-row">
          <div className="flex items-center gap-4">
            <div className="fms-pos-clockin-alert-icon rounded-2xl p-3">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-amber-100">
                Staff Clock-In Required Prior to Processing POS Transactions
              </h3>
              <p className="text-xs text-amber-300">
                DT-FMS mandates PIN clock-in to link sales with attendant 3-way shift cash/meter/tank reconciliation.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenClockInModal}
            className="fms-btn fms-btn-warning whitespace-nowrap"
          >
            Clock In Now With Security PIN
          </button>
        </div>
      )}

      {/* POS Header */}
      <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-slate-100 text-base flex items-center gap-2">
                Multi-Product Station POS Terminal
                {activeShift && (
                  <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded font-normal border border-emerald-500/30">
                    On Duty: {activeShift.staffName} ({activeShift.shiftType})
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Process sales for Piped Bulk Fuels, Lubricants, Engine Oils, LPG Gas Cylinders, and Convenience Goods.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-mono hidden md:inline">CART ITEMS:</span>
            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl font-bold font-mono text-xs">
              {unifiedCart.length} Item(s)
            </span>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex overflow-x-auto gap-2 pt-2 border-t border-slate-800/80 scrollbar-none">
          {[
            { id: 'Piped Fuel', label: '⛽ Piped Fuel (Pumps)', color: 'emerald' },
            { id: 'Lubricants & Oils', label: '🛢️ Motor Oils & Lubricants', color: 'amber' },
            { id: 'Gas Cylinders', label: '⚡ LPG Gas Cylinders', color: 'purple' },
            { id: 'Coolants & Care', label: '🧪 Coolants & Additives', color: 'blue' },
            { id: 'Snacks & Drinks', label: '🥤 Snacks & Beverages', color: 'cyan' },
            { id: 'Car Accessories', label: '🚗 Car Care & Accessories', color: 'rose' },
            { id: 'All Catalog', label: '🛍️ Full Product Catalog', color: 'indigo' },
          ].map((cat) => {
            const isActive = activeTabCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveTabCategory(cat.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                  isActive
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/20'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                }`}
              >
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Fuel Dispenser Panel */}
          {(activeTabCategory === 'Piped Fuel' || activeTabCategory === 'All Catalog') && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="font-bold text-slate-100 text-sm uppercase tracking-wider flex items-center gap-2">
                  <Fuel className="w-4 h-4 text-emerald-400" />
                  1. Piped Fuel Dispenser Configuration
                </h3>
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Live Pump Meters Active
                </span>
              </div>

              {/* Select Fuel Grade */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">
                  Select Fuel Grade
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {products.map((p) => {
                    const isSelected = selectedProduct.id === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSelectFuelProduct(p)}
                        className={`p-3.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-950/40 text-slate-100 shadow-lg shadow-emerald-500/10'
                            : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-850'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs truncate">{p.name}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-slate-800 text-slate-300">
                            {p.code}
                          </span>
                        </div>
                        <div className="text-lg font-black text-emerald-400 font-mono mt-2">
                          KES {p.pricePerLiter.toFixed(2)}
                          <span className="text-[10px] text-slate-400 font-sans font-normal"> / L</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Select Nozzle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-400">
                    Select Dispensing Nozzle
                  </label>
                  <span className="text-[11px] font-mono text-emerald-300 bg-slate-950 border border-emerald-500/20 px-2 py-1 rounded">
                    {selectedPump ? `${selectedPump.pumpName} / ${selectedPump.nozzleName || `Nozzle ${selectedPump.nozzleNumber || 1}`}` : 'No nozzle selected'}
                  </span>
                </div>
                {compatiblePumps.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {compatiblePumps.map((nozzle) => {
                      const isSelected = selectedPump?.id === nozzle.id;
                      return (
                        <button
                          key={nozzle.id}
                          onClick={() => {
                            setSelectedPump(nozzle);
                            const matchingProduct = products.find((product) => product.id === nozzle.fuelProductId);
                            if (matchingProduct) {
                              setSelectedProduct(matchingProduct);
                            }
                          }}
                          className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                            isSelected
                              ? 'border-emerald-500 bg-emerald-950/30 text-slate-100'
                              : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:bg-slate-850'
                          }`}
                        >
                          <div>
                            <div className="font-bold text-xs text-slate-200">{nozzle.pumpName} / {nozzle.nozzleName || `Nozzle ${nozzle.nozzleNumber || 1}`}</div>
                            <div className="text-[11px] text-slate-400">Nozzle reading: {nozzle.currentMeterReading.toFixed(1)} L</div>
                          </div>
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-slate-700'}`}>
                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-center justify-between">
                    <span>
                      ⚠️ No active nozzle is configured for <strong>{selectedProduct.name}</strong>. Configure a compatible nozzle and source tank in the <strong>Pumps & Tanks</strong> tab.
                    </span>
                  </div>
                )}
              </div>

              {/* Presets & Inputs */}
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <label className="block text-xs font-semibold text-slate-400">
                  Quick Amount Presets
                </label>
                <div className="flex flex-wrap gap-2">
                  {[500, 1000, 2000, 3000, 5000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => handlePresetAmount(amt)}
                      className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold font-mono text-xs rounded-xl transition-all border border-slate-700 active:scale-95"
                    >
                      KES {amt.toLocaleString()}
                    </button>
                  ))}
                  <button
                    onClick={() => handleLitersChange(50)}
                    className="px-3.5 py-1.5 bg-emerald-950 text-emerald-300 font-bold font-mono text-xs rounded-xl border border-emerald-500/30 hover:bg-emerald-900"
                  >
                    Full Tank (50 L)
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Fuel Volume (Liters)</label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={fuelQtyLiters}
                        onChange={(e) => {
                          if (!selectedPump) return;
                          handleLitersChange(parseFloat(e.target.value) || 0);
                        }}
                        disabled={!selectedPump}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-lg font-bold font-mono text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span className="absolute right-4 top-3 text-xs text-slate-500 font-bold">LITERS</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Total Dispense Price (KES)</label>
                    <div className="relative">
                      <input
                        type="number"
                        step="1"
                        min="10"
                        value={fuelAmountKes}
                        onChange={(e) => {
                          if (!selectedPump) return;
                          handleAmountChange(parseFloat(e.target.value) || 0);
                        }}
                        disabled={!selectedPump}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-lg font-bold font-mono text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span className="absolute right-4 top-3 text-xs text-slate-500 font-bold">KES</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    onClick={handleAddFuelToCart}
                    disabled={!selectedPump || !activeShift}
                    className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                    Add Fuel Dispense to Cart ({fuelQtyLiters} L)
                  </button>
                  <button
                    onClick={handleExpressFuelSale}
                    disabled={!activeShift || !selectedPump || isSubmitting}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Zap className="w-4 h-4" />
                    Express Quick Fuel Sale (KES {fuelAmountKes.toLocaleString()})
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Popular Products */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-bold text-slate-200 text-xs flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                Popular Fuel Products & Automotive Fluids (Fast Add)
              </h4>
              <span className="text-[10px] text-slate-400">Direct In-Stock Inventory</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {topFuelProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addShopItemToCart(p)}
                  className="bg-slate-950 p-3 rounded-xl border border-slate-800 hover:border-amber-500/50 text-left transition-all group"
                >
                  <div className="text-[10px] text-amber-400 font-mono truncate">{p.category}</div>
                  <div className="font-bold text-xs text-slate-100 truncate mt-0.5">{p.name}</div>
                  <div className="text-xs font-mono font-bold text-emerald-400 mt-1">
                    KES {p.unitPrice.toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Catalog Grid */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 justify-between items-center">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Search fuel products, motor oils, LPG gas, coolants, snacks..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
              <div className="text-xs text-slate-400 font-mono whitespace-nowrap">
                Showing {filteredShopItems.length} Products
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {catalogPagination.pageItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-between gap-3 hover:border-emerald-500/40 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-emerald-400 font-mono font-semibold uppercase">
                      <span>{item.category}</span>
                      <span>Code: {item.code}</span>
                    </div>
                    <h4 className="font-bold text-slate-100 text-xs mt-1.5">{item.name}</h4>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5">
                    <div>
                      <div className="text-sm font-black font-mono text-emerald-400">
                        KES {item.unitPrice.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Stock: <span className="font-bold text-slate-200">{item.stockQty}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => addShopItemToCart(item)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add to Cart
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <PaginationControls
              currentPage={catalogPagination.currentPage}
              totalPages={catalogPagination.totalPages}
              itemCount={filteredShopItems.length}
              onPageChange={catalogPagination.setCurrentPage}
            />
          </div>
        </div>

        {/* Right Column: Cart & Checkout */}
        <div className="self-start bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col">
          <div className="flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-400" />
                Order Cart & Tax Invoice
              </h3>
              <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold rounded">
                VAT Tax Tagged
              </span>
            </div>

            {/* Customer Details */}
            <div className="space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Fleet / Customer Details
                </label>
                <button
                  type="button"
                  onClick={() => setShowQuickAddCustomer(true)}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2 py-1 hover:bg-emerald-500/15"
                >
                  <Plus className="w-3 h-3" />
                  Quick Add Customer
                </button>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search registered customer by name, PIN, phone, or plate"
                    value={customerSearchTerm}
                    onChange={(e) => setCustomerSearchTerm(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                {customerSearchTerm.trim() && matchingCustomers.length > 0 && (
                  <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-1.5 space-y-1">
                    {matchingCustomers.slice(0, 5).map((cust) => (
                      <button
                        key={cust.id}
                        type="button"
                        onClick={() => handleQuickCustomerSelect(cust)}
                        className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-slate-800"
                      >
                        <div>
                          <div className="font-semibold text-slate-200">{cust.name}</div>
                          <div className="text-slate-400 font-mono">{cust.kraPin || cust.phone}</div>
                        </div>
                        <span className="text-[10px] text-emerald-400">Select</span>
                      </button>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  placeholder="Vehicle Reg Plate (e.g. KDG 482L)"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 uppercase focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Customer / Company Name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Customer KRA PIN (e.g. P051283912Z)"
                  value={customerPin}
                  onChange={(e) => setCustomerPin(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 uppercase focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Cart Items */}
            <div className="space-y-2 pr-1 mt-4 mb-0 max-h-[42vh] overflow-y-auto">
              {unifiedCart.length === 0 ? (
                <div className="text-center py-5 text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl p-4 space-y-1">
                  <ShoppingCart className="w-6 h-6 mx-auto text-slate-600" />
                  <p>Cart is empty.</p>
                  <p className="text-[10px]">Add fuel dispense or shop items to build the transaction.</p>
                </div>
              ) : (
                unifiedCart.map((cartItem) => (
                  <div
                    key={cartItem.id}
                    className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                        {cartItem.type === 'Fuel' ? (
                          <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30">
                            FUEL
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.2 bg-blue-500/20 text-blue-300 rounded border border-blue-500/30">
                            SHOP
                          </span>
                        )}
                        <span className="truncate max-w-[140px]">{cartItem.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        KES {cartItem.unitPrice.toFixed(2)} x {cartItem.qty} = KES {(cartItem.unitPrice * cartItem.qty).toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {cartItem.type === 'Shop' && (
                        <>
                          <button
                            onClick={() => updateCartQty(cartItem.id, -1)}
                            className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-mono text-xs font-bold w-5 text-center">{cartItem.qty}</span>
                          <button
                            onClick={() => updateCartQty(cartItem.id, 1)}
                            className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => removeFromCart(cartItem.id)}
                        className="p-1 text-rose-400 hover:bg-rose-500/10 rounded ml-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Payment Method */}
            <div className="pt-3 border-t border-slate-800 space-y-2 mt-0">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Payment Channel
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['M-Pesa', 'Cash', 'Card', 'Credit'] as PaymentMethod[]).map((method) => {
                  const isSelected = paymentMethod === method;
                  return (
                    <button
                      key={method}
                      onClick={() => setPaymentMethod(method)}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-950/40 text-emerald-400'
                          : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:bg-slate-850'
                      }`}
                    >
                      {method === 'M-Pesa' && <PhoneCall className="w-3.5 h-3.5" />}
                      {method === 'Cash' && <DollarSign className="w-3.5 h-3.5" />}
                      {method === 'Card' && <CreditCard className="w-3.5 h-3.5" />}
                      {method === 'Credit' && <Building2 className="w-3.5 h-3.5" />}
                      <span>{method}</span>
                    </button>
                  );
                })}
              </div>

              {paymentMethod === 'Credit' && (
                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-300">
                    <span>Document Type</span>
                    <span className="font-mono text-emerald-400">{matchedCustomer ? `Available: KES ${availableCredit.toLocaleString()}` : 'No customer selected'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['Receipt', 'Invoice'] as const).map((type) => {
                      const disabled = type === 'Invoice' && !canIssueCreditInvoice;
                      return (
                        <button
                          key={type}
                          disabled={disabled}
                          onClick={() => {
                            if (!disabled) setDocumentType(type);
                            if (disabled) setDocumentType('Receipt');
                          }}
                          className={`py-2 rounded-xl border text-xs font-bold transition-all ${
                            documentType === type
                              ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300'
                              : disabled
                                ? 'border-slate-800 bg-slate-900 text-slate-600 cursor-not-allowed'
                                : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500'
                          }`}
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                  {!matchedCustomer && (
                    <div className="text-[10px] text-amber-300">No matching customer found. Only a receipt can be issued unless you quick-add the customer.</div>
                  )}
                  {matchedCustomer && !canIssueCreditInvoice && (
                    <div className="text-[10px] text-amber-300">Customer credit is exhausted or blocked. Receipt mode is required until the limit is restored.</div>
                  )}
                </div>
              )}

              {paymentMethod === 'M-Pesa' && (
                <div className="bg-emerald-950/30 border border-emerald-500/20 p-3 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
                    <span>M-Pesa Express STK Prompt</span>
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Phone (+254...)"
                      value={mpesaPhoneNumber}
                      onChange={(e) => setMpesaPhoneNumber(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono w-full focus:outline-none"
                    />
                    <button
                      onClick={handleSimulateStkPush}
                      disabled={stkPushSimulating}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-all whitespace-nowrap shadow-md shadow-emerald-600/20"
                    >
                      {stkPushSimulating ? 'Prompting...' : 'Send STK'}
                    </button>
                  </div>
                  {stkPushSuccess && (
                    <div className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Payment Verified! Ref: {paymentRef}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Totals & Checkout Button */}
          <div className="pt-3 border-t border-slate-800 space-y-3 mt-0">
            {/* ✅ SUMMARY – correctly handles VAT‑inclusive prices */}
            <div className="space-y-1 font-mono text-xs text-slate-400">
              <div className="flex justify-between">
                <span>Subtotal Excl. Tax:</span>
                <span>KES {subtotalExclTax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Total Tax:</span>
                <span>KES {totalTax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-emerald-400 pt-2 border-t border-slate-800 font-mono">
                <span>TOTAL PAYABLE:</span>
                <span>KES {totalPayable.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <button
              onClick={handleCartCheckout}
              disabled={!activeShift || totalPayable <= 0 || isSubmitting}
              className={`w-full py-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-xl ${
                !activeShift || totalPayable <= 0 || isSubmitting
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 active:scale-[0.98]'
              }`}
            >
              <QrCode className="w-4 h-4" />
              {isSubmitting ? 'Processing Tax Invoice...' : 'Checkout Cart & Issue Tax Receipt'}
            </button>
          </div>
        </div>
      </div>

      {/* Quick Add Customer Modal */}
      {showQuickAddCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-100 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                Quick Add Customer
              </h3>
              <button onClick={() => setShowQuickAddCustomer(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="col-span-2">
                <label className="block text-slate-400 mb-1">Customer / Company Name *</label>
                <input
                  type="text"
                  value={quickCustomerName}
                  onChange={(e) => setQuickCustomerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  placeholder="e.g. Greenline Logistics"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">KRA PIN *</label>
                <input
                  type="text"
                  value={quickCustomerPin}
                  onChange={(e) => setQuickCustomerPin(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-mono focus:outline-none"
                  placeholder="P051234567A"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Phone *</label>
                <input
                  type="text"
                  value={quickCustomerPhone}
                  onChange={(e) => setQuickCustomerPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none"
                  placeholder="0722 000000"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  value={quickCustomerEmail}
                  onChange={(e) => setQuickCustomerEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  placeholder="accounts@company.co.ke"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Credit Limit (KES)</label>
                <input
                  type="number"
                  min="0"
                  value={quickCustomerLimit}
                  onChange={(e) => setQuickCustomerLimit(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 font-mono text-emerald-400 focus:outline-none"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-slate-400 mb-1">Vehicle Plates (comma separated)</label>
                <input
                  type="text"
                  value={quickCustomerVehicles}
                  onChange={(e) => setQuickCustomerVehicles(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 font-mono uppercase text-white focus:outline-none"
                  placeholder="KDG 482L, KBL 321M"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-slate-400 mb-1">Address</label>
                <input
                  type="text"
                  value={quickCustomerAddress}
                  onChange={(e) => setQuickCustomerAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  placeholder="Physical address"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowQuickAddCustomer(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingQuickCustomer}
                onClick={handleQuickCustomerSave}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl disabled:opacity-50"
              >
                {isSavingQuickCustomer ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};