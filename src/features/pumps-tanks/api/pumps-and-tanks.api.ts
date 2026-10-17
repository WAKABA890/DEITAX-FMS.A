import {
  INITIAL_DELIVERIES,
  INITIAL_PRODUCTS,
  INITIAL_PUMPS,
  INITIAL_TANKS,
} from '../../../data/initialData';
import type { FuelDelivery, FuelProduct, FuelPump, FuelTank, PumpNozzle } from '../../../types';
import { fetchApi } from '../../../shared/api/http-client';

export interface AuditActor {
  userId?: string;
  userName?: string;
  userRole?: string;
}

/**
 * API actions for physical fuel assets, product prices, tank setup, deliveries,
 * and manual dip setup. The UI never owns these endpoint paths or payloads.
 */
export const pumpsAndTanksApi = {
  getTankEvidence: (page = 1) => fetchApi<any>('/api/tanks/evidence?page=' + page),
  createManualDip: (data: Record<string, unknown>) => fetchApi<any>('/api/tanks/dip', { method: 'POST', body: JSON.stringify(data) }),

  getTanks: () => fetchApi<FuelTank[]>('/api/tanks', undefined, INITIAL_TANKS),

  registerTank: (tankData: any, actor: AuditActor = {}) =>
    fetchApi<FuelTank>('/api/tanks', {
      method: 'POST',
      body: JSON.stringify({ ...tankData, ...actor }),
    }),

  deleteTank: (tankId: string, actor: AuditActor = {}) =>
    fetchApi<{ success: boolean; deletedTank: FuelTank; deletedPumps: PumpNozzle[] }>('/api/tanks/' + tankId, {
      method: 'DELETE',
      body: JSON.stringify(actor),
    }),

  recordInitialDip: (tankId: string, dipReadingLiters: number, actor: AuditActor = {}) =>
    fetchApi<FuelTank>('/api/tanks/dip', {
      method: 'POST',
      body: JSON.stringify({ tankId, dipReadingLiters, initialSetup: true, ...actor }),
    }),

  getDeliveries: () => fetchApi<FuelDelivery[]>('/api/deliveries', undefined, INITIAL_DELIVERIES),

  addDelivery: (deliveryData: any) =>
    fetchApi<{ delivery: FuelDelivery; updatedTank: FuelTank }>('/api/deliveries', {
      method: 'POST',
      body: JSON.stringify(deliveryData),
    }),

  getPumps: () => fetchApi<PumpNozzle[]>('/api/pumps', undefined, INITIAL_PUMPS),
  getPumpUnits: () => fetchApi<FuelPump[]>('/api/pump-units', undefined, []),

  registerPump: (pumpData: any, actor: AuditActor = {}) =>
    fetchApi<PumpNozzle>('/api/pumps', {
      method: 'POST',
      body: JSON.stringify({ ...pumpData, ...actor }),
    }),

  deletePump: (pumpId: string, actor: AuditActor = {}) =>
    fetchApi<{ success: boolean; deletedPump: PumpNozzle }>('/api/pumps/' + pumpId, {
      method: 'DELETE',
      body: JSON.stringify(actor),
    }),

  deletePumpUnit: (pumpUnitId: string, actor: AuditActor = {}) =>
    fetchApi<{ success: boolean }>('/api/pump-units/' + pumpUnitId, {
      method: 'DELETE',
      body: JSON.stringify(actor),
    }),

  getProducts: () => fetchApi<FuelProduct[]>('/api/products', undefined, INITIAL_PRODUCTS),

  updateProductPrice: (
    productId: string,
    newPrice: number,
    taxCode?: string,
    productName?: string,
    actor: AuditActor = {}
  ) => fetchApi<FuelProduct>('/api/products/price', {
    method: 'POST',
    body: JSON.stringify({ productId, newPrice, taxCode, productName, ...actor }),
  }),

  updateFuelProduct: (productId: string, productData: Partial<FuelProduct>, actor: AuditActor = {}) =>
    fetchApi<FuelProduct>('/api/products/' + productId, {
      method: 'PUT',
      body: JSON.stringify({ ...productData, ...actor }),
    }),

  deleteFuelProduct: (productId: string, actor: AuditActor = {}) =>
    fetchApi<{ success: boolean; deletedProduct: FuelProduct }>('/api/products/' + productId, {
      method: 'DELETE',
      body: JSON.stringify(actor),
    }),
};
