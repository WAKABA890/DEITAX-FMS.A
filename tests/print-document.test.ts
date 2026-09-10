import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildIsolatedPrintHtml } from '../src/utils/print-document.ts';

test('isolated print HTML contains only the selected document markup', () => {
  const selectedDocument = '<article data-printable-document><h1>CREDIT NOTE Cn-2026-0004</h1><p>Original Document No: Rcpt-2026-0022</p></article>';
  const printedHtml = buildIsolatedPrintHtml(selectedDocument, '<style>.receipt { color: black; }</style>', 'http://localhost:3001/');

  assert.match(printedHtml, /CREDIT NOTE Cn-2026-0004/);
  assert.match(printedHtml, /Original Document No: Rcpt-2026-0022/);
  assert.match(printedHtml, /printable-document-root/);
  assert.doesNotMatch(printedHtml, /Sidebar/);
  assert.doesNotMatch(printedHtml, /POS Terminal/);
  assert.doesNotMatch(printedHtml, /Document Archive/);
  assert.doesNotMatch(printedHtml, /modal backdrop/i);
});

test('isolated print HTML excludes screen-only controls through print CSS', () => {
  const printedHtml = buildIsolatedPrintHtml('<article class="receipt-screen-ui">Preview error</article>', '', 'http://localhost:3001/');

  assert.match(printedHtml, /\.receipt-screen-ui, \.no-print \{ display: none !important; \}/);
});

test('thermal print output uses the receipt width only during printing', () => {
  const printedHtml = buildIsolatedPrintHtml('<article class="thermal-receipt">Receipt</article>', '', 'http://localhost:3001/', {
    pageSize: '80mm auto',
  });

  assert.match(printedHtml, /@media print/);
  assert.match(printedHtml, /@page \{ size: 80mm auto; margin: 0; \}/);
  assert.match(printedHtml, /width: 80mm; max-width: 80mm/);
  assert.match(printedHtml, /body \* \{ visibility: hidden; \}/);
});
