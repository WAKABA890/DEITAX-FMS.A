import type { TankStockMovement } from '../types';

export const tankStockPercent = (currentLevelLiters: unknown, capacityLiters: unknown): number => {
  const currentLevel = Number(currentLevelLiters);
  const capacity = Number(capacityLiters);
  if (!Number.isFinite(currentLevel) || !Number.isFinite(capacity) || capacity <= 0) return 0;
  return Math.min(100, Math.max(0, (currentLevel / capacity) * 100));
};

export const formatTankStockMovement = (movement?: TankStockMovement | null): string => {
  if (!movement) return 'No stock movement recorded';
  const quantity = Number(movement.quantityLiters);
  const litres = Math.abs(Number.isFinite(quantity) ? quantity : 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

  switch (movement.movementType) {
    case 'PTS2_FUEL_SALE':
      return 'PTS-2 sale: ' + litres + ' L deducted';
    case 'CREDIT_NOTE_RTT':
      return 'RTT return: ' + litres + ' L added';
    case 'FUEL_DELIVERY':
      return 'Fuel delivery: ' + litres + ' L added';
    case 'TANK_OPENING_BALANCE':
      return 'Opening stock: ' + litres + ' L set';
    case 'MANUAL_DIP':
      return 'Manual dip recorded';
    default:
      return (quantity >= 0 ? 'Stock increase: ' : 'Stock decrease: ') + litres + (quantity >= 0 ? ' L added' : ' L deducted');
  }
};
