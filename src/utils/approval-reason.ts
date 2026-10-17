const labelFor = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

/** Format stored evidence for display without changing the audit record. */
export function readableApprovalReason(reason: unknown): string {
  let value = String(reason ?? '');
  value = value.replace(/(Nozzle evidence|Tank evidence):\s*(\[[\s\S]*?\])(?=\s*(?:Tank evidence:|Requested by:|$))/g, (original, title, json) => {
    try {
      const records = JSON.parse(json);
      if (!Array.isArray(records) || records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) return original;
      return `\n\n${title}\n` + records.map((record, index) => {
        const name = [record.pumpName || record.tankName || `Record ${index + 1}`, record.nozzleName, record.fuelName].filter(Boolean).join(' / ');
        const points = Object.entries(record).map(([key, data]) => {
          const formatted = data == null ? 'Not recorded' : typeof data === 'number'
            ? data.toLocaleString('en-KE', { maximumFractionDigits: 3 })
            : typeof data === 'object' ? JSON.stringify(data) : String(data).replace(/_/g, ' ');
          const unit = typeof data === 'number' && /(?:Meter|Liters|Dip|Sales|Usage|Delta|Quantity|Volume)/i.test(key) && !/(?:Id|Number)$/.test(key) ? ' L' : '';
          return `  • ${labelFor(key)}: ${formatted}${unit}`;
        });
        return `${index + 1}. ${name}\n${points.join('\n')}`;
      }).join('\n\n');
    } catch {
      return original; // Keep malformed or older evidence visible in full.
    }
  });
  return value
    .replace(/;\s*/g, '\n• ')
    .replace(/\s+\|\s+/g, '\n  • ')
    .replace(/\s+(Cash variance:|Pump variance:|Tank variance:|Controller\/meter exception:|Controller read failed:|Outstanding opening\/reading variances:)/g, '\n\n• $1')
    .replace(/\s+(pump\s+\d+:)/gi, '\n\n• $1')
    .trim();
}
