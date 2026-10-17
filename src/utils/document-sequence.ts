import type Database from 'better-sqlite3';

/** Shares the existing annual counter with manual POS; safe inside posting transactions. */
export function nextDocumentSequence(sqlite: Database.Database, kind: 'invoice'|'receipt'|'credit-note') {
  return sqlite.transaction(() => {
    const year = new Date().getFullYear();
    const row = sqlite.prepare('SELECT last_number, updated_at FROM document_counters WHERE document_type=?').get(kind) as any;
    const next = row && new Date(row.updated_at).getFullYear() === year ? Number(row.last_number) + 1 : 1;
    sqlite.prepare('INSERT INTO document_counters(document_type,last_number,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(document_type) DO UPDATE SET last_number=excluded.last_number,updated_at=CURRENT_TIMESTAMP').run(kind,next);
    return next;
  })();
}
export function nextReceiptNumber(sqlite: Database.Database) {
  return 'Rcpt-' + new Date().getFullYear() + '-' + String(nextDocumentSequence(sqlite,'receipt')).padStart(4,'0');
}
