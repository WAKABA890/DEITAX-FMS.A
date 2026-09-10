export interface PrintDocumentOptions {
  pageSize?: string;
}

export const buildIsolatedPrintHtml = (
  documentMarkup: string,
  stylesMarkup: string,
  baseUrl: string,
  options: PrintDocumentOptions = {}
) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base href="${baseUrl}" />
    ${stylesMarkup}
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; }
      #printable-document-root { display: block; margin: 0; padding: 0; }
      .receipt-screen-ui, .no-print { display: none !important; }
      @media print {
        @page { size: ${options.pageSize ?? 'auto'}; margin: 0; }
        body * { visibility: hidden; }
        #printable-document-root,
        #printable-document-root * { visibility: visible; }
        ${options.pageSize === '80mm auto' ? '#printable-document-root { position: absolute; top: 0; left: 0; width: 80mm; max-width: 80mm; margin: 0; padding: 0; }' : ''}
      }
    </style>
  </head>
  <body>
    <div id="printable-document-root">${documentMarkup}</div>
  </body>
</html>`;

const collectPrintStyles = () => Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
  .map((element) => element.outerHTML)
  .join('\n');

export const printSelectedDocument = (target: HTMLElement, options: PrintDocumentOptions = {}) => {
  if (!target) {
    throw new Error('Selected document is unavailable for printing.');
  }

  const printWindow = window.open('', '_blank', 'popup,width=600,height=900');
  if (!printWindow) {
    throw new Error('The print window was blocked. Allow pop-ups and try again.');
  }

  const printMarkup = buildIsolatedPrintHtml(target.outerHTML, collectPrintStyles(), window.location.href, options);
  printWindow.document.open();
  printWindow.document.write(printMarkup);
  printWindow.document.close();

  printWindow.addEventListener('afterprint', () => {
    printWindow.close();
  }, { once: true });

  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 100);
};
