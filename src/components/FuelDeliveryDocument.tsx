import React from 'react';
import { FuelDelivery, StationSettings } from '../types';

interface FuelDeliveryDocumentProps {
  delivery: FuelDelivery;
  settings?: StationSettings | null;
  documentNo?: string;
}

const formatNumber = (value: number, decimals = 2) =>
  Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export const FuelDeliveryDocument: React.FC<FuelDeliveryDocumentProps> = ({
  delivery,
  documentNo,
}) => {
  const reference = delivery.deliveryNoteNo || documentNo || delivery.id || '-';
  const displayDocumentNo = documentNo || reference;
  const date = new Date(delivery.timestamp);
  const openingLevel = Number(delivery.openingLevel || 0);
  const litersReceived = Number(delivery.litersReceived || 0);
  const storedClosingLevel = Number(delivery.closingLevel || 0);
  const closingLevel = storedClosingLevel || openingLevel + litersReceived;

  return (
    <article className="fuel-delivery-document bg-white text-[#111111]" aria-label="Fuel delivery receipt">
      <h1 className="text-center text-[12px] font-extrabold uppercase">Delivery Record</h1>

      <section className="mt-3 space-y-1 text-[10px]">
        <div className="flex justify-between gap-3"><span className="text-slate-600">Document No:</span><span className="text-right font-bold">{displayDocumentNo}</span></div>
        <div className="flex justify-between gap-3"><span className="text-slate-600">Date / Time:</span><span className="text-right font-semibold">{date.toLocaleString('en-KE')}</span></div>
        <div className="flex justify-between gap-3"><span className="text-slate-600">Customer / Entity:</span><span className="text-right font-semibold">Supplier: {delivery.supplierName || '-'}</span></div>
      </section>

      <section className="mt-4">
        <h2 className="border-b border-slate-400 pb-1 text-[10px] font-extrabold uppercase">Delivery Information</h2>
        <div className="mt-2 space-y-1 text-[10px]">
          <div className="flex justify-between gap-3"><span className="text-slate-600">Delivery Reference</span><span className="text-right font-semibold">{reference}</span></div>
          <div className="flex justify-between gap-3"><span className="text-slate-600">Supplier</span><span className="text-right font-semibold">{delivery.supplierName || '-'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-slate-600">Vehicle Registration</span><span className="text-right font-semibold">{delivery.truckPlate || '-'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-slate-600">Driver</span><span className="text-right font-semibold">{delivery.driverName || '-'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-slate-600">Logged By</span><span className="text-right font-semibold">{delivery.receivedBy || '-'}</span></div>
        </div>
      </section>

      <section className="mt-4">
        <h2 className="border-b border-slate-400 pb-1 text-[10px] font-extrabold uppercase">Delivery Details</h2>
        <div className="mt-2 grid grid-cols-[1.35fr_.65fr_.85fr_.85fr] gap-1 border-b border-slate-300 pb-1 text-[8px] font-extrabold uppercase text-slate-600">
          <span>Tank / Product</span><span className="text-right">Qty</span><span className="text-right">Unit Price (KES)</span><span className="text-right">Value (KES)</span>
        </div>
        <div className="grid grid-cols-[1.35fr_.65fr_.85fr_.85fr] gap-1 py-2 text-[10px]">
          <span className="min-w-0 break-words font-semibold">{delivery.tankName || '-'}</span><span className="text-right tabular-nums">{formatNumber(delivery.litersReceived, 0)} L</span><span className="text-right tabular-nums">{formatNumber(delivery.costPerLiter)}</span><span className="text-right font-bold tabular-nums">{formatNumber(delivery.totalCost)}</span>
        </div>
      </section>

      <section className="mt-4">
        <h2 className="border-b border-slate-400 pb-1 text-[10px] font-extrabold uppercase">Tank Reconciliation</h2>
        <div className="mt-2 grid grid-cols-[1fr_.75fr_.9fr_.75fr] gap-1 border-b border-slate-300 pb-1 text-[8px] font-extrabold uppercase text-slate-600">
          <span>Tank</span><span className="text-right">Before</span><span className="text-right">Delivered</span><span className="text-right">After</span>
        </div>
        <div className="grid grid-cols-[1fr_.75fr_.9fr_.75fr] gap-1 py-2 text-[10px]">
          <span className="min-w-0 break-words font-semibold">{delivery.tankName || '-'}</span><span className="text-right tabular-nums">{formatNumber(openingLevel, 0)} L</span><span className="text-right tabular-nums">{formatNumber(litersReceived, 0)} L</span><span className="text-right font-semibold tabular-nums">{formatNumber(closingLevel, 0)} L</span>
        </div>
      </section>

      <section className="mt-4 border border-slate-300 bg-slate-50 px-3 py-2">
        <div className="text-[9px] font-extrabold uppercase text-slate-600">Total Delivery Value</div>
        <div className="mt-1 text-right text-[14px] font-extrabold tabular-nums">KES {formatNumber(delivery.totalCost)}</div>
      </section>

    </article>
  );
};
