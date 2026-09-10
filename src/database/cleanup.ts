import type Database from 'better-sqlite3';

export function ensurePumpRecord(
  sqlite: Database.Database,
  physicalPumpId: string | null,
  pumpNumber: number,
  pumpName: string,
) {
  const normalizedPumpName = String(pumpName || `Pump ${pumpNumber}`).trim() || `Pump ${pumpNumber}`;
  const existing = sqlite
    .prepare('SELECT id, pump_name FROM pumps WHERE pump_number = ?')
    .get(pumpNumber) as { id: string; pump_name: string } | undefined;

  if (existing) {
    if (existing.pump_name !== normalizedPumpName) {
      sqlite
        .prepare('UPDATE pumps SET pump_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(normalizedPumpName, existing.id);
    }

    return { id: existing.id, created: false };
  }

  const resolvedPumpId = String(physicalPumpId || `pump-${Date.now()}-${pumpNumber}`);
  sqlite
    .prepare('INSERT INTO pumps (id, pump_number, pump_name, status) VALUES (?, ?, ?, ?)')
    .run(resolvedPumpId, pumpNumber, normalizedPumpName, 'Active');

  return { id: resolvedPumpId, created: true };
}

export function deletePumpNozzleAndLinkedRecords(sqlite: Database.Database, nozzleId: string) {
  // Delete nozzle-specific history and variances
  sqlite.prepare('DELETE FROM nozzle_reading_history WHERE nozzle_id = ?').run(nozzleId);
  sqlite.prepare('DELETE FROM reading_variances WHERE nozzle_id = ?').run(nozzleId);
  // Preserve transactions by setting nozzle_id to NULL
  sqlite.prepare('UPDATE transactions SET nozzle_id = NULL WHERE nozzle_id = ?').run(nozzleId);
  sqlite.prepare('DELETE FROM pump_nozzles WHERE id = ?').run(nozzleId);
}

export function deleteTankAndLinkedRecords(sqlite: Database.Database, tankId: string) {
  const deleteTransaction = sqlite.transaction((id: string) => {
    // Get all nozzles linked to this tank
    const nozzles = sqlite
      .prepare('SELECT id FROM pump_nozzles WHERE tank_id = ?')
      .all(id) as Array<{ id: string }>;
    const nozzleIds = nozzles.map((row) => row.id);

    // 1. Delete nozzle reading history for the nozzles and the tank
    if (nozzleIds.length > 0) {
      const placeholders = nozzleIds.map(() => '?').join(', ');
      sqlite.prepare(
        `DELETE FROM nozzle_reading_history WHERE nozzle_id IN (${placeholders}) OR tank_id = ?`
      ).run(...nozzleIds, id);
    } else {
      sqlite.prepare('DELETE FROM nozzle_reading_history WHERE tank_id = ?').run(id);
    }

    // 2. Delete reading variances for the nozzles and the tank
    if (nozzleIds.length > 0) {
      const placeholders = nozzleIds.map(() => '?').join(', ');
      sqlite.prepare(
        `DELETE FROM reading_variances WHERE nozzle_id IN (${placeholders}) OR tank_id = ?`
      ).run(...nozzleIds, id);
    } else {
      sqlite.prepare('DELETE FROM reading_variances WHERE tank_id = ?').run(id);
    }

    // 3. Preserve transaction history: set nozzle_id to NULL for any transactions referencing these nozzles
    if (nozzleIds.length > 0) {
      const placeholders = nozzleIds.map(() => '?').join(', ');
      sqlite.prepare(
        `UPDATE transactions SET nozzle_id = NULL WHERE nozzle_id IN (${placeholders})`
      ).run(...nozzleIds);
    }

    // 4. Delete fuel deliveries that reference this tank
    sqlite.prepare('DELETE FROM fuel_deliveries WHERE tank_id = ?').run(id);

    // 5. Delete the pump nozzles themselves
    sqlite.prepare('DELETE FROM pump_nozzles WHERE tank_id = ?').run(id);

    // 6. Finally, delete the tank
    sqlite.prepare('DELETE FROM fuel_tanks WHERE id = ?').run(id);
  });

  deleteTransaction(tankId);
}

export function deleteProductAndLinkedRecords(sqlite: Database.Database, productId: string) {
  sqlite.prepare('DELETE FROM nozzle_reading_history WHERE fuel_product_id = ?').run(productId);
  sqlite.prepare('DELETE FROM reading_variances WHERE fuel_product_id = ?').run(productId);
  sqlite.prepare('DELETE FROM pump_nozzles WHERE fuel_product_id = ?').run(productId);
  sqlite.prepare('DELETE FROM fuel_tanks WHERE fuel_product_id = ?').run(productId);
  sqlite.prepare('DELETE FROM fuel_deliveries WHERE fuel_product_id = ?').run(productId);
  sqlite.prepare('DELETE FROM transactions WHERE product_id = ?').run(productId);
  sqlite.prepare('DELETE FROM fuel_products WHERE id = ?').run(productId);
}