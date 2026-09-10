import React, { useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx-js-style';

import {
  BarChart3,
  Download,
  Printer,
  PieChart,
  FileText,
  Activity,
  Wallet,
} from 'lucide-react';

import {
  Transaction,
  ShiftSession,
  FuelTank,
  PumpNozzle,
  FuelDelivery,
  CashFlowRecord,
  AuditLog,
  CreditNote,
  StationSettings,
  User,
} from '../types';

interface ReportsProps {
  transactions: Transaction[];
  shifts: ShiftSession[];
  tanks: FuelTank[];
  pumps: PumpNozzle[];
  deliveries?: FuelDelivery[];
  cashFlow?: CashFlowRecord[];
  auditLogs?: AuditLog[];
  creditNotes?: CreditNote[];
  settings?: StationSettings;
  currentUser?: User;
}

type RangeKey = 'weekly' | 'monthly' | 'yearly' | 'custom';

type ProductPerformanceRow = {
  productName: string;
  category: string;
  quantity: number;
  unit: string;
  salesValue: number;
  percentOfTotalSales: number;
};

const PAGE_HEADER_ROWS = 7;

const formatMoney = (value: number) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatCount = (value: number) =>
  Number(value || 0).toLocaleString('en-KE');

const formatShortDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const toNumber = (
  value: number | string | undefined | null
): number => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : 0;
};

const buildRangeText = (start: Date, end: Date) =>
  `${formatShortDate(start)} – ${formatShortDate(end)}`;

const toDisplayDateTime = (value: Date) =>
  value.toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const getBusinessName = (settings?: StationSettings) =>
  (settings?.stationName || 'BUSINESS NAME').trim().toUpperCase();

const resolveDocumentKind = (
  tx: Pick<Transaction, 'documentType' | 'taxInvoiceNo' | 'receiptNo'>
): 'Invoice' | 'Receipt' => {
  if (tx.documentType === 'Invoice') return 'Invoice';
  if (tx.documentType === 'Receipt') return 'Receipt';

  if (tx.taxInvoiceNo) return 'Invoice';
  if (tx.receiptNo) return 'Receipt';

  return 'Receipt';
};

/**
 * Safely apply KES formatting to numeric cells.
 */
const applyCurrencyNumberFormat = (
  sheet: XLSX.WorkSheet,
  columnIndex: number,
  startRow: number,
  endRow: number
) => {
  if (!sheet || startRow > endRow) return;

  for (let row = startRow; row <= endRow; row += 1) {
    const cellRef = XLSX.utils.encode_cell({
      c: columnIndex,
      r: row,
    });

    const cell = sheet[cellRef];

    if (cell && cell.t === 'n') {
      cell.z = '#,##0.00';
    }
  }
};

/**
 * Apply basic formatting safely.
 */
const styleHeaderRows = (
  sheet: XLSX.WorkSheet,
  lastColumn: number
) => {
  if (!sheet) return;

  const headerRows = [0, 1, 2];

  headerRows.forEach((rowIndex) => {
    for (let column = 0; column <= lastColumn; column += 1) {
      const cellRef = XLSX.utils.encode_cell({
        c: column,
        r: rowIndex,
      });

      const cell = sheet[cellRef];

      if (!cell) continue;

      if (rowIndex === 0) {
        cell.s = {
          font: {
            bold: true,
            sz: 16,
          },
          alignment: {
            horizontal: 'center',
          },
        };
      } else if (rowIndex === 1) {
        cell.s = {
          font: {
            bold: true,
            sz: 12,
          },
          alignment: {
            horizontal: 'center',
          },
        };
      } else {
        cell.s = {
          font: {
            italic: true,
            sz: 10,
          },
          alignment: {
            horizontal: 'center',
          },
        };
      }
    }
  });
};

/**
 * Creates a worksheet safely.
 *
 * Important:
 * We create the worksheet from an array first and then
 * modify it. This avoids the undefined push issue encountered
 * with workbook/sheet handling.
 */
const createSheet = (
  rows: unknown[][],
  columnWidths: number[]
): XLSX.WorkSheet => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);

  sheet['!cols'] = columnWidths.map((wch) => ({
    wch,
  }));

  return sheet;
};

/**
 * Adds a worksheet only if it is valid.
 */
const appendSheetSafely = (
  workbook: XLSX.WorkBook,
  sheet: XLSX.WorkSheet,
  name: string
) => {
  if (!workbook) {
    throw new Error('Excel workbook could not be created.');
  }

  if (!sheet) {
    throw new Error(`Excel worksheet "${name}" could not be created.`);
  }

  if (!workbook.SheetNames) {
    workbook.SheetNames = [];
  }

  if (!workbook.Sheets) {
    workbook.Sheets = {};
  }

  XLSX.utils.book_append_sheet(workbook, sheet, name);
};

export const Reports: React.FC<ReportsProps> = ({
  transactions = [],
  shifts = [],
  tanks = [],
  pumps = [],
  deliveries = [],
  cashFlow = [],
  auditLogs = [],
  creditNotes = [],
  settings,
  currentUser,
}) => {
  const [selectedRange, setSelectedRange] =
    useState<RangeKey>('monthly');

  const [customStart, setCustomStart] =
    useState<string>('');

  const [customEnd, setCustomEnd] =
    useState<string>('');

  const [exportError, setExportError] =
    useState<string | null>(null);

  const businessName = getBusinessName(settings);
  const generatedBy = currentUser?.name || 'System';

  const timeRange = useMemo(() => {
    const now = new Date();

    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    );

    if (selectedRange === 'weekly') {
      const start = new Date(end);

      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);

      return {
        start,
        end,
      };
    }

    if (selectedRange === 'monthly') {
      const start = new Date(
        end.getFullYear(),
        end.getMonth(),
        1,
        0,
        0,
        0,
        0
      );

      return {
        start,
        end,
      };
    }

    if (selectedRange === 'yearly') {
      const start = new Date(
        end.getFullYear(),
        0,
        1,
        0,
        0,
        0,
        0
      );

      return {
        start,
        end,
      };
    }

    if (selectedRange === 'custom' && customStart) {
      const customStartDate = new Date(`${customStart}T00:00:00`);

      const customEndDate = customEnd
        ? new Date(`${customEnd}T23:59:59.999`)
        : new Date(end);

      if (
        Number.isNaN(customStartDate.getTime()) ||
        Number.isNaN(customEndDate.getTime())
      ) {
        return {
          start: new Date(
            end.getFullYear(),
            0,
            1,
            0,
            0,
            0,
            0
          ),
          end,
        };
      }

      return {
        start: customStartDate,
        end: customEndDate,
      };
    }

    return {
      start: new Date(
        end.getFullYear(),
        0,
        1,
        0,
        0,
        0,
        0
      ),
      end,
    };
  }, [selectedRange, customStart, customEnd]);

  const isInRange = (value?: string) => {
    if (!value) return false;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return false;
    }

    return (
      date >= timeRange.start &&
      date <= timeRange.end
    );
  };

  const reportSnapshot = useMemo(() => {
    const filteredTransactions =
      transactions.filter((tx) =>
        isInRange(tx.timestamp)
      );

    const filteredDeliveries =
      deliveries.filter((delivery) =>
        isInRange(delivery.timestamp)
      );

    const filteredCashFlow =
      cashFlow.filter((flow) =>
        isInRange(flow.timestamp)
      );

    const filteredAuditLogs =
      auditLogs.filter((entry) =>
        isInRange(entry.timestamp)
      );

    const filteredCreditNotes =
      creditNotes.filter((note) =>
        isInRange(note.timestamp)
      );

    const completedTx =
      filteredTransactions.filter(
        (transaction) =>
          transaction.status === 'Completed'
      );

    const totalRevenue =
      completedTx.reduce(
        (sum, transaction) =>
          sum + toNumber(transaction.totalAmount),
        0
      );

    const receiptTransactions =
      completedTx.filter(
        (transaction) =>
          resolveDocumentKind(transaction) === 'Receipt'
      );

    const invoiceTransactions =
      completedTx.filter(
        (transaction) =>
          resolveDocumentKind(transaction) === 'Invoice'
      );

    const receiptTotal =
      receiptTransactions.reduce(
        (sum, transaction) =>
          sum + toNumber(transaction.totalAmount),
        0
      );

    const invoiceTotal =
      invoiceTransactions.reduce(
        (sum, transaction) =>
          sum + toNumber(transaction.totalAmount),
        0
      );

    const receiptCount =
      receiptTransactions.length;

    const invoiceCount =
      invoiceTransactions.length;

    const creditNoteCount =
      filteredCreditNotes.length;

    const creditNoteTotal =
      filteredCreditNotes.reduce(
        (sum, note) =>
          sum + toNumber(note.totalAmount),
        0
      );

    const deliveryCount =
      filteredDeliveries.length;

    const deliveryAmount =
      filteredDeliveries.reduce(
        (sum, item) =>
          sum + toNumber(item.totalCost),
        0
      );

    const deliveryLiters =
      filteredDeliveries.reduce(
        (sum, item) =>
          sum + toNumber(item.litersReceived),
        0
      );

    const expenseRowsSource =
      filteredCashFlow.filter(
        (flow) => flow.type === 'Outflow'
      );

    const expenseTotal =
      expenseRowsSource.reduce(
        (sum, flow) =>
          sum + toNumber(flow.amount),
        0
      );

    const inflowTotal =
      receiptTotal + invoiceTotal;

    const netCashInflow =
      inflowTotal -
      creditNoteTotal -
      expenseTotal;

    const cashFlowInflow =
      filteredCashFlow
        .filter((flow) => flow.type === 'Inflow')
        .reduce(
          (sum, flow) =>
            sum + toNumber(flow.amount),
          0
        );

    const cashFlowOutflow =
      filteredCashFlow
        .filter((flow) => flow.type === 'Outflow')
        .reduce(
          (sum, flow) =>
            sum + toNumber(flow.amount),
          0
        );

    const paymentBreakdown =
      completedTx.reduce(
        (
          accumulator,
          transaction
        ) => {
          const method =
            transaction.paymentMethod ||
            'Unknown';

          accumulator[method] =
            (accumulator[method] || 0) +
            toNumber(transaction.totalAmount);

          return accumulator;
        },
        {} as Record<string, number>
      );

    const fuelSales =
      completedTx.reduce(
        (sum, transaction) => {
          const fuelItems =
            (transaction.items || []).filter(
              (item) => item.type === 'Fuel'
            );

          return (
            sum +
            fuelItems.reduce(
              (itemSum, item) =>
                itemSum +
                toNumber(item.totalPrice),
              0
            )
          );
        },
        0
      );

    const shopSales =
      completedTx.reduce(
        (sum, transaction) => {
          const shopItems =
            (transaction.items || []).filter(
              (item) => item.type === 'Shop'
            );

          return (
            sum +
            shopItems.reduce(
              (itemSum, item) =>
                itemSum +
                toNumber(item.totalPrice),
              0
            )
          );
        },
        0
      );

    const activityBreakdown =
      filteredAuditLogs.reduce(
        (
          accumulator,
          entry
        ) => {
          const moduleName =
            entry.module || 'Unknown';

          accumulator[moduleName] =
            (accumulator[moduleName] || 0) + 1;

          return accumulator;
        },
        {} as Record<string, number>
      );

    const documentSummary = [
      {
        label: 'Deliveries',
        count: deliveryCount,
        total: deliveryAmount,
      },
      {
        label: 'Receipts',
        count: receiptCount,
        total: receiptTotal,
      },
      {
        label: 'Invoices',
        count: invoiceCount,
        total: invoiceTotal,
      },
      {
        label: 'Credit Notes',
        count: creditNoteCount,
        total: creditNoteTotal,
      },
      {
        label: 'Expenses',
        count: expenseRowsSource.length,
        total: expenseTotal,
      },
    ];

    const productPerformanceRows =
      completedTx.flatMap(
        (transaction) =>
          (transaction.items || []).map(
            (item) => ({
              productName:
                item.name || 'Unknown Product',

              category:
                item.type === 'Fuel'
                  ? 'Fuel'
                  : item.type === 'Shop'
                    ? 'Retail'
                    : 'Other',

              quantity:
                toNumber(item.qty),

              unit:
                item.type === 'Fuel'
                  ? 'Litres'
                  : 'Units',

              salesValue:
                toNumber(item.totalPrice),
            })
          )
      );

    const productSalesMap =
      productPerformanceRows.reduce(
        (
          accumulator,
          row
        ) => {
          const key = row.productName;

          if (!accumulator[key]) {
            accumulator[key] = {
              productName:
                row.productName,

              category:
                row.category,

              quantity: 0,

              unit:
                row.unit,

              salesValue: 0,
            };
          }

          accumulator[key].quantity +=
            row.quantity;

          accumulator[key].salesValue +=
            row.salesValue;

          return accumulator;
        },
        {} as Record<
          string,
          Omit<
            ProductPerformanceRow,
            'percentOfTotalSales'
          >
        >
      );

    const productPerformance: ProductPerformanceRow[] =
      Object.values(productSalesMap)
        .map((row) => ({
          ...row,

          percentOfTotalSales:
            totalRevenue > 0
              ? (row.salesValue /
                  totalRevenue) *
                100
              : 0,
        }))
        .sort(
          (a, b) =>
            b.salesValue -
            a.salesValue
        );

    const productTotalSales =
      productPerformance.reduce(
        (sum, row) =>
          sum + row.salesValue,
        0
      );

    const receiptRows =
      receiptTransactions.map(
        (transaction) => ({
          date: transaction.timestamp
            ? formatShortDate(
                new Date(
                  transaction.timestamp
                )
              )
            : '',

          receiptNo:
            transaction.receiptNo || '',

          customer:
            transaction.customerName ||
            'Walk-in Customer',

          paymentMethod:
            transaction.paymentMethod ||
            'Cash',

          amount:
            toNumber(
              transaction.totalAmount
            ),
        })
      );

    const invoiceRows =
      invoiceTransactions.map(
        (transaction) => ({
          date: transaction.timestamp
            ? formatShortDate(
                new Date(
                  transaction.timestamp
                )
              )
            : '',

          invoiceNo:
            transaction.taxInvoiceNo ||
            transaction.receiptNo ||
            '',

          customer:
            transaction.customerName ||
            'Walk-in Customer',

          amount:
            toNumber(
              transaction.totalAmount
            ),

          status:
            transaction.status ||
            'Completed',
        })
      );

    const creditNoteRows =
      filteredCreditNotes.map(
        (note) => ({
          date: note.timestamp
            ? formatShortDate(
                new Date(note.timestamp)
              )
            : '',

          creditNoteNo:
            note.creditNoteNo || '',

          originalDocumentNo:
            note.originalDocumentNo ||
            note.originalInvoiceNo ||
            note.originalReceiptNo ||
            '',

          reason:
            note.reason ||
            'Credit adjustment',

          amount:
            toNumber(
              note.totalAmount
            ),
        })
      );

    const deliveryRows =
      filteredDeliveries.map(
        (delivery) => ({
          date: delivery.timestamp
            ? formatShortDate(
                new Date(
                  delivery.timestamp
                )
              )
            : '',

          deliveryRef:
            delivery.deliveryNoteNo ||
            delivery.id ||
            '',

          supplier:
            delivery.supplierName ||
            'Supplier',

          product:
            delivery.tankName ||
            'Fuel',

          quantity:
            toNumber(
              delivery.litersReceived
            ),

          value:
            toNumber(
              delivery.totalCost
            ),
        })
      );

    const expenseRows =
      expenseRowsSource.map(
        (flow) => ({
          date: flow.timestamp
            ? formatShortDate(
                new Date(flow.timestamp)
              )
            : '',

          expenseRef:
            flow.referenceNo ||
            flow.id ||
            '',

          category:
            flow.category ||
            'Operating Expense',

          description:
            flow.description ||
            'Expense',

          amount:
            toNumber(flow.amount),
        })
      );

    const paymentRows =
      Object.entries(paymentBreakdown)
        .map(
          ([method, amount]) => ({
            paymentMethod:
              method,

            transactionCount:
              completedTx.filter(
                (transaction) =>
                  (
                    transaction.paymentMethod ||
                    'Unknown'
                  ) === method
              ).length,

            totalAmount:
              amount,
          })
        )
        .sort(
          (a, b) =>
            b.totalAmount -
            a.totalAmount
        );

    return {
      filteredTransactions,
      filteredDeliveries,
      filteredCashFlow,
      filteredAuditLogs,
      filteredCreditNotes,

      completedTx,

      totalRevenue,

      receiptTransactions,
      invoiceTransactions,

      receiptTotal,
      invoiceTotal,

      receiptCount,
      invoiceCount,

      creditNoteCount,
      creditNoteTotal,

      deliveryCount,
      deliveryAmount,
      deliveryLiters,

      expenseTotal,

      inflowTotal,
      netCashInflow,

      cashFlowInflow,
      cashFlowOutflow,

      paymentBreakdown,

      fuelSales,
      shopSales,

      activityBreakdown,

      documentSummary,

      productPerformance,
      productTotalSales,

      receiptRows,
      invoiceRows,
      creditNoteRows,
      deliveryRows,
      expenseRows,
      paymentRows,

      periodLabel:
        buildRangeText(
          timeRange.start,
          timeRange.end
        ),
    };
  }, [
    transactions,
    deliveries,
    cashFlow,
    auditLogs,
    creditNotes,
    timeRange,
  ]);

  const {
    totalRevenue,
    receiptCount,
    invoiceCount,
    creditNoteCount,
    creditNoteTotal,
    deliveryCount,
    deliveryAmount,
    deliveryLiters,
    expenseTotal,
    inflowTotal,
    netCashInflow,
    cashFlowInflow,
    cashFlowOutflow,
    paymentBreakdown,
    fuelSales,
    shopSales,
    documentSummary,
    productPerformance,
    productTotalSales,
    receiptRows,
    invoiceRows,
    creditNoteRows,
    deliveryRows,
    expenseRows,
    paymentRows,
    periodLabel,
    filteredAuditLogs,
  } = reportSnapshot;

  const handlePrintReport = () => {
    window.print();
  };

  /**
   * Excel export
   *
   * Important fixes:
   * 1. Uses xlsx-js-style directly.
   * 2. Creates one workbook only.
   * 3. Creates every worksheet before appending.
   * 4. Does not manipulate workbook internals unnecessarily.
   * 5. Uses safe worksheet creation.
   * 6. Uses correct zero-based Excel row indexes.
   * 7. Validates workbook before writing.
   */
  const exportExcel = () => {
    setExportError(null);

    try {
      console.log(
        '[Reports] Starting Excel export...'
      );

      console.log(
        '[Reports] XLSX library:',
        XLSX
      );

      if (
        !XLSX ||
        !XLSX.utils ||
        typeof XLSX.utils.book_new !==
          'function' ||
        typeof XLSX.utils.aoa_to_sheet !==
          'function' ||
        typeof XLSX.utils.book_append_sheet !==
          'function' ||
        typeof XLSX.writeFile !==
          'function'
      ) {
        throw new Error(
          'The Excel library failed to initialise. Make sure Reports.tsx imports xlsx-js-style.'
        );
      }

      const workbook =
        XLSX.utils.book_new();

      if (!workbook) {
        throw new Error(
          'Failed to create Excel workbook.'
        );
      }

      const generatedOn =
        new Date().toLocaleString(
          'en-KE'
        );

      /*
       * --------------------------------------------------
       * SUMMARY
       * --------------------------------------------------
       */

      const summaryRows: unknown[][] = [
        [businessName],
        ['REPORTS & ANALYTICS'],
        [
          'Financial Performance & Business Activity Report',
        ],
        ['Report Period', periodLabel],
        ['Generated', generatedOn],
        ['Generated By', generatedBy],
        [],
        ['Metric', 'Value'],
        [
          'Total Sales',
          toNumber(totalRevenue),
        ],
        [
          'Fuel Sales',
          toNumber(fuelSales),
        ],
        [
          'Shop / Retail Sales',
          toNumber(shopSales),
        ],
        [
          'Total Receipts',
          toNumber(
            receiptRows.reduce(
              (sum, row) =>
                sum + row.amount,
              0
            )
          ),
        ],
        [
          'Total Invoices',
          toNumber(
            invoiceRows.reduce(
              (sum, row) =>
                sum + row.amount,
              0
            )
          ),
        ],
        [
          'Total Credit Notes',
          toNumber(
            creditNoteTotal
          ),
        ],
        [
          'Total Expenses',
          toNumber(expenseTotal),
        ],
        [
          'Total Cash Inflow',
          toNumber(inflowTotal),
        ],
        [
          'Total Cash Outflow',
          toNumber(
            cashFlowOutflow
          ),
        ],
        [
          'Net Cash Flow',
          toNumber(netCashInflow),
        ],
      ];

      const summarySheet =
        createSheet(
          summaryRows,
          [32, 24]
        );

      styleHeaderRows(
        summarySheet,
        1
      );

      applyCurrencyNumberFormat(
        summarySheet,
        1,
        8,
        17
      );

      appendSheetSafely(
        workbook,
        summarySheet,
        'Summary'
      );

      /*
       * --------------------------------------------------
       * SALES ANALYSIS
       * --------------------------------------------------
       */

      const salesRows: unknown[][] = [
        [businessName],
        ['REPORTS & ANALYTICS'],
        [
          'Financial Performance & Business Activity Report',
        ],
        ['Report Period', periodLabel],
        ['Generated', generatedOn],
        ['Generated By', generatedBy],
        [],
        ['Metric', 'Value'],
        [
          'Total Sales',
          toNumber(totalRevenue),
        ],
        [
          'Fuel Sales',
          toNumber(fuelSales),
        ],
        [
          'Shop / Retail Sales',
          toNumber(shopSales),
        ],
        [
          'Total Receipts',
          receiptRows.reduce(
            (sum, row) =>
              sum + row.amount,
            0
          ),
        ],
        [
          'Total Invoices',
          invoiceRows.reduce(
            (sum, row) =>
              sum + row.amount,
            0
          ),
        ],
        [
          'Total Credit Notes',
          toNumber(
            creditNoteTotal
          ),
        ],
        [
          'Total Expenses',
          toNumber(expenseTotal),
        ],
        [
          'Total Cash Inflow',
          toNumber(inflowTotal),
        ],
        [
          'Total Cash Outflow',
          toNumber(
            cashFlowOutflow
          ),
        ],
        [
          'Net Cash Flow',
          toNumber(netCashInflow),
        ],
      ];

      const salesSheet =
        createSheet(
          salesRows,
          [32, 24]
        );

      styleHeaderRows(
        salesSheet,
        1
      );

      applyCurrencyNumberFormat(
        salesSheet,
        1,
        8,
        17
      );

      appendSheetSafely(
        workbook,
        salesSheet,
        'Sales Analysis'
      );

      /*
       * --------------------------------------------------
       * PRODUCT PERFORMANCE
       * --------------------------------------------------
       */

      const productRows: unknown[][] = [
        [
          'Product Name',
          'Product Category',
          'Quantity Sold',
          'Unit',
          'Total Sales Value',
          '% of Total Sales',
        ],

        ...productPerformance.map(
          (row) => [
            row.productName,
            row.category,
            toNumber(row.quantity),
            row.unit,
            toNumber(
              row.salesValue
            ),
            Number(
              row.percentOfTotalSales ||
                0
            ),
          ]
        ),
      ];

      const productSheetRows: unknown[][] = [
        [businessName],
        ['REPORTS & ANALYTICS'],
        [
          'Financial Performance & Business Activity Report',
        ],
        ['Report Period', periodLabel],
        ['Generated', generatedOn],
        ['Generated By', generatedBy],
        [],
        ...productRows,
        [],
        [
          'TOTAL PRODUCT SALES VALUE',
          '',
          '',
          '',
          toNumber(
            productTotalSales
          ),
        ],
      ];

      const productSheet =
        createSheet(
          productSheetRows,
          [
            28,
            20,
            16,
            12,
            20,
            18,
          ]
        );

      styleHeaderRows(
        productSheet,
        5
      );

      const productHeaderRow =
        PAGE_HEADER_ROWS;

      const productDataStartRow =
        productHeaderRow + 1;

      const productDataEndRow =
        productDataStartRow +
        productPerformance.length -
        1;

      if (
        productPerformance.length >
        0
      ) {
        applyCurrencyNumberFormat(
          productSheet,
          4,
          productDataStartRow,
          productDataEndRow
        );

        const percentageStart =
          productDataStartRow;

        const percentageEnd =
          productDataEndRow;

        for (
          let row =
            percentageStart;
          row <= percentageEnd;
          row += 1
        ) {
          const cellRef =
            XLSX.utils.encode_cell({
              c: 5,
              r: row,
            });

          if (
            productSheet[cellRef]
          ) {
            productSheet[cellRef].z =
              '0.0%';

            /*
             * Values are stored as percentages
             * such as 25.5 rather than 0.255.
             *
             * Therefore display with normal
             * numeric formatting instead.
             */
            productSheet[cellRef].z =
              '0.0';
          }
        }

        productSheet['!autofilter'] = {
          ref: `A${productHeaderRow + 1}:F${
            productDataEndRow + 1
          }`,
        };
      }

      appendSheetSafely(
        workbook,
        productSheet,
        'Product Performance'
      );

      /*
       * --------------------------------------------------
       * FUEL SALES
       * --------------------------------------------------
       */

      const fuelProducts =
        productPerformance.filter(
          (row) =>
            row.category === 'Fuel'
        );

      const fuelRows: unknown[][] = [
        [
          'Product / Fuel Type',
          'Quantity Sold',
          'Unit',
          'Sales Value',
        ],

        ...fuelProducts.map(
          (row) => [
            row.productName,
            toNumber(row.quantity),
            row.unit,
            toNumber(
              row.salesValue
            ),
          ]
        ),
      ];

      const fuelSheet =
        createSheet(
          [
            [businessName],
            ['Fuel Sales Report'],
            ['Report Period', periodLabel],
            [],
            ...fuelRows,
          ],
          [
            30,
            18,
            14,
            20,
          ]
        );

      styleHeaderRows(
        fuelSheet,
        3
      );

      if (
        fuelProducts.length > 0
      ) {
        applyCurrencyNumberFormat(
          fuelSheet,
          3,
          4,
          3 +
            fuelProducts.length
        );
      }

      appendSheetSafely(
        workbook,
        fuelSheet,
        'Fuel Sales'
      );

      /*
       * --------------------------------------------------
       * RETAIL SALES
       * --------------------------------------------------
       */

      const retailProducts =
        productPerformance.filter(
          (row) =>
            row.category === 'Retail'
        );

      const retailRows: unknown[][] = [
        [
          'Product',
          'Quantity Sold',
          'Unit',
          'Sales Value',
        ],

        ...retailProducts.map(
          (row) => [
            row.productName,
            toNumber(row.quantity),
            row.unit,
            toNumber(
              row.salesValue
            ),
          ]
        ),
      ];

      const retailSheet =
        createSheet(
          [
            [businessName],
            [
              'Retail / Shop Sales Report',
            ],
            ['Report Period', periodLabel],
            [],
            ...retailRows,
          ],
          [
            30,
            18,
            14,
            20,
          ]
        );

      styleHeaderRows(
        retailSheet,
        3
      );

      if (
        retailProducts.length > 0
      ) {
        applyCurrencyNumberFormat(
          retailSheet,
          3,
          4,
          3 +
            retailProducts.length
        );
      }

      appendSheetSafely(
        workbook,
        retailSheet,
        'Shop Retail Sales'
      );

      /*
       * --------------------------------------------------
       * RECEIPTS
       * --------------------------------------------------
       */

      const receiptSheetRows: unknown[][] = [
        [businessName],
        ['Receipts'],
        ['Report Period', periodLabel],
        [],
        [
          'Date',
          'Receipt Number',
          'Customer',
          'Payment Method',
          'Amount',
        ],

        ...receiptRows.map(
          (row) => [
            row.date,
            row.receiptNo,
            row.customer,
            row.paymentMethod,
            toNumber(row.amount),
          ]
        ),
      ];

      const receiptSheet =
        createSheet(
          receiptSheetRows,
          [
            14,
            22,
            28,
            20,
            20,
          ]
        );

      styleHeaderRows(
        receiptSheet,
        4
      );

      if (
        receiptRows.length > 0
      ) {
        applyCurrencyNumberFormat(
          receiptSheet,
          4,
          4,
          4 +
            receiptRows.length
        );

        receiptSheet['!autofilter'] = {
          ref: `A5:E${
            5 +
            receiptRows.length -
            1
          }`,
        };
      }

      appendSheetSafely(
        workbook,
        receiptSheet,
        'Receipts'
      );

      /*
       * --------------------------------------------------
       * INVOICES
       * --------------------------------------------------
       */

      const invoiceSheetRows: unknown[][] = [
        [businessName],
        ['Invoices'],
        ['Report Period', periodLabel],
        [],
        [
          'Date',
          'Invoice Number',
          'Customer',
          'Amount',
          'Status',
        ],

        ...invoiceRows.map(
          (row) => [
            row.date,
            row.invoiceNo,
            row.customer,
            toNumber(row.amount),
            row.status,
          ]
        ),
      ];

      const invoiceSheet =
        createSheet(
          invoiceSheetRows,
          [
            14,
            22,
            28,
            20,
            18,
          ]
        );

      styleHeaderRows(
        invoiceSheet,
        4
      );

      if (
        invoiceRows.length > 0
      ) {
        applyCurrencyNumberFormat(
          invoiceSheet,
          3,
          4,
          4 +
            invoiceRows.length
        );

        invoiceSheet['!autofilter'] = {
          ref: `A5:E${
            5 +
            invoiceRows.length -
            1
          }`,
        };
      }

      appendSheetSafely(
        workbook,
        invoiceSheet,
        'Invoices'
      );

      /*
       * --------------------------------------------------
       * CREDIT NOTES
       * --------------------------------------------------
       */

      const creditNoteSheetRows: unknown[][] = [
        [businessName],
        ['Credit Notes'],
        ['Report Period', periodLabel],
        [],
        [
          'Date',
          'Credit Note Number',
          'Original Document Number',
          'Reason',
          'Amount',
        ],

        ...creditNoteRows.map(
          (row) => [
            row.date,
            row.creditNoteNo,
            row.originalDocumentNo,
            row.reason,
            toNumber(row.amount),
          ]
        ),
      ];

      const creditNoteSheet =
        createSheet(
          creditNoteSheetRows,
          [
            14,
            24,
            28,
            32,
            20,
          ]
        );

      styleHeaderRows(
        creditNoteSheet,
        4
      );

      if (
        creditNoteRows.length >
        0
      ) {
        applyCurrencyNumberFormat(
          creditNoteSheet,
          4,
          4,
          4 +
            creditNoteRows.length
        );

        creditNoteSheet[
          '!autofilter'
        ] = {
          ref: `A5:E${
            5 +
            creditNoteRows.length -
            1
          }`,
        };
      }

      appendSheetSafely(
        workbook,
        creditNoteSheet,
        'Credit Notes'
      );

      /*
       * --------------------------------------------------
       * DELIVERIES
       * --------------------------------------------------
       */

      const deliverySheetRows: unknown[][] = [
        [businessName],
        ['Fuel Deliveries'],
        ['Report Period', periodLabel],
        [],
        [
          'Date',
          'Delivery Reference',
          'Supplier',
          'Product',
          'Quantity',
          'Value',
        ],

        ...deliveryRows.map(
          (row) => [
            row.date,
            row.deliveryRef,
            row.supplier,
            row.product,
            toNumber(
              row.quantity
            ),
            toNumber(row.value),
          ]
        ),
      ];

      const deliverySheet =
        createSheet(
          deliverySheetRows,
          [
            14,
            22,
            24,
            24,
            18,
            20,
          ]
        );

      styleHeaderRows(
        deliverySheet,
        5
      );

      if (
        deliveryRows.length > 0
      ) {
        applyCurrencyNumberFormat(
          deliverySheet,
          5,
          4,
          4 +
            deliveryRows.length
        );

        deliverySheet[
          '!autofilter'
        ] = {
          ref: `A5:F${
            5 +
            deliveryRows.length -
            1
          }`,
        };
      }

      appendSheetSafely(
        workbook,
        deliverySheet,
        'Deliveries'
      );

      /*
       * --------------------------------------------------
       * EXPENSES
       * --------------------------------------------------
       */

      const expenseSheetRows: unknown[][] = [
        [businessName],
        ['Expenses'],
        ['Report Period', periodLabel],
        [],
        [
          'Date',
          'Expense Reference',
          'Category',
          'Description',
          'Amount',
        ],

        ...expenseRows.map(
          (row) => [
            row.date,
            row.expenseRef,
            row.category,
            row.description,
            toNumber(row.amount),
          ]
        ),
      ];

      const expenseSheet =
        createSheet(
          expenseSheetRows,
          [
            14,
            22,
            24,
            34,
            20,
          ]
        );

      styleHeaderRows(
        expenseSheet,
        4
      );

      if (
        expenseRows.length > 0
      ) {
        applyCurrencyNumberFormat(
          expenseSheet,
          4,
          4,
          4 +
            expenseRows.length
        );

        expenseSheet[
          '!autofilter'
        ] = {
          ref: `A5:E${
            5 +
            expenseRows.length -
            1
          }`,
        };
      }

      appendSheetSafely(
        workbook,
        expenseSheet,
        'Expenses'
      );

      /*
       * --------------------------------------------------
       * PAYMENT ANALYSIS
       * --------------------------------------------------
       */

      const paymentSheetRows: unknown[][] = [
        [businessName],
        ['Payment Analysis'],
        ['Report Period', periodLabel],
        [],
        [
          'Payment Method',
          'Transaction Count',
          'Total Amount',
        ],

        ...paymentRows.map(
          (row) => [
            row.paymentMethod,
            toNumber(
              row.transactionCount
            ),
            toNumber(
              row.totalAmount
            ),
          ]
        ),
      ];

      const paymentSheet =
        createSheet(
          paymentSheetRows,
          [
            24,
            20,
            22,
          ]
        );

      styleHeaderRows(
        paymentSheet,
        2
      );

      if (
        paymentRows.length > 0
      ) {
        applyCurrencyNumberFormat(
          paymentSheet,
          2,
          4,
          4 +
            paymentRows.length
        );

        paymentSheet[
          '!autofilter'
        ] = {
          ref: `A5:C${
            5 +
            paymentRows.length -
            1
          }`,
        };
      }

      appendSheetSafely(
        workbook,
        paymentSheet,
        'Payment Analysis'
      );

      /*
       * --------------------------------------------------
       * AUDIT ACTIVITY
       * --------------------------------------------------
       */

      const activityRows = Object.entries(
        reportSnapshot.activityBreakdown
      ).map(
        ([module, count]) => [
          module,
          count,
        ]
      );

      const activitySheet =
        createSheet(
          [
            [businessName],
            ['Audit Activity Summary'],
            [
              'Report Period',
              periodLabel,
            ],
            [],
            [
              'Module',
              'Activity Count',
            ],
            ...activityRows,
          ],
          [
            28,
            20,
          ]
        );

      styleHeaderRows(
        activitySheet,
        1
      );

      appendSheetSafely(
        workbook,
        activitySheet,
        'Audit Activity'
      );

      /*
       * --------------------------------------------------
       * FINAL VALIDATION
       * --------------------------------------------------
       */

      if (
        !workbook.SheetNames ||
        workbook.SheetNames.length === 0
      ) {
        throw new Error(
          'No worksheets were created for the Excel report.'
        );
      }

      console.log(
        '[Reports] Excel sheets:',
        workbook.SheetNames
      );

      const fileStem =
        businessName
          .toLowerCase()
          .replace(
            /[^a-z0-9]+/g,
            '-'
          )
          .replace(
            /^-+|-+$/g,
            ''
          ) ||
        'station';

      const filename =
        `${fileStem}-reports-analytics-${selectedRange}.xlsx`;

      /*
       * writeFile must be the LAST operation.
       */
      XLSX.writeFile(
        workbook,
        filename,
        {
          bookType: 'xlsx',
          compression: true,
        }
      );

      console.log(
        `[Reports] Excel export successful: ${filename}`
      );
    } catch (error) {
      console.error(
        '[Reports] Excel export failed:',
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      setExportError(
        `Excel export failed: ${message}`
      );
    }
  };

  const exportPdf = () => {
    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth =
        doc.internal.pageSize.getWidth();

      const generatedOn =
        new Date();

      const generatedOnText =
        toDisplayDateTime(
          generatedOn
        );

      doc.setFillColor(
        15,
        23,
        42
      );

      doc.rect(
        0,
        0,
        pageWidth,
        32,
        'F'
      );

      doc.setTextColor(
        255,
        255,
        255
      );

      doc.setFontSize(16);

      doc.text(
        businessName,
        14,
        16
      );

      doc.setFontSize(11);

      doc.text(
        'REPORTS & ANALYTICS',
        14,
        23
      );

      doc.setTextColor(
        15,
        23,
        42
      );

      doc.setFontSize(11);

      doc.text(
        'Financial Performance & Business Activity Report',
        14,
        40
      );

      doc.setFontSize(9);

      doc.text(
        `Report Period: ${periodLabel}`,
        14,
        48
      );

      doc.text(
        `Generated On: ${generatedOnText}`,
        14,
        54
      );

      doc.text(
        `Generated By: ${generatedBy}`,
        14,
        60
      );

      const summaryMetrics = [
        [
          'Total Sales',
          formatMoney(
            totalRevenue
          ),
        ],
        [
          'Fuel Sales',
          formatMoney(
            fuelSales
          ),
        ],
        [
          'Shop / Retail Sales',
          formatMoney(
            shopSales
          ),
        ],
        [
          'Total Receipts',
          formatMoney(
            receiptRows.reduce(
              (sum, row) =>
                sum + row.amount,
              0
            )
          ),
        ],
        [
          'Total Invoices',
          formatMoney(
            invoiceRows.reduce(
              (sum, row) =>
                sum + row.amount,
              0
            )
          ),
        ],
        [
          'Total Credit Notes',
          formatMoney(
            creditNoteTotal
          ),
        ],
        [
          'Total Expenses',
          formatMoney(
            expenseTotal
          ),
        ],
        [
          'Total Cash Inflow',
          formatMoney(
            inflowTotal
          ),
        ],
        [
          'Total Cash Outflow',
          formatMoney(
            cashFlowOutflow
          ),
        ],
        [
          'Net Cash Flow',
          formatMoney(
            netCashInflow
          ),
        ],
      ];

      autoTable(doc, {
        startY: 72,
        head: [
          ['Metric', 'Value'],
        ],
        body: summaryMetrics,
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [
            22,
            163,
            74,
          ],
          textColor: [
            255,
            255,
            255,
          ],
          fontStyle: 'bold',
        },
        alternateRowStyles: {
          fillColor: [
            241,
            245,
            249,
          ],
        },
        columnStyles: {
          1: {
            halign: 'right',
          },
        },
        margin: {
          left: 14,
          right: 14,
        },
      });

      let nextY =
        (
          doc as any
        ).lastAutoTable.finalY +
        10;

      doc.setFontSize(11);

      doc.text(
        'SECTION 2: DOCUMENT & BUSINESS ACTIVITY SUMMARY',
        14,
        nextY
      );

      nextY += 6;

      const activityBody =
        documentSummary.map(
          (row) => [
            row.label,
            String(row.count),
            formatMoney(
              row.total
            ),
          ]
        );

      autoTable(doc, {
        startY: nextY,
        head: [
          [
            'Activity / Document Type',
            'Count',
            'Total Value',
          ],
        ],
        body:
          activityBody.length > 0
            ? activityBody
            : [
                [
                  'No activity recorded for the selected period.',
                  '0',
                  formatMoney(0),
                ],
              ],
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [
            14,
            116,
            144,
          ],
          textColor: [
            255,
            255,
            255,
          ],
          fontStyle: 'bold',
        },
        margin: {
          left: 14,
          right: 14,
        },
      });

      nextY =
        (
          doc as any
        ).lastAutoTable.finalY +
        10;

      doc.setFontSize(11);

      doc.text(
        'SECTION 3: PRODUCT SALES PERFORMANCE',
        14,
        nextY
      );

      nextY += 6;

      const productBody =
        productPerformance.length >
        0
          ? productPerformance.map(
              (row) => [
                row.productName,
                row.category,
                String(
                  row.quantity
                ),
                row.unit,
                formatMoney(
                  row.salesValue
                ),
                `${(
                  row.percentOfTotalSales ||
                  0
                ).toFixed(1)}%`,
              ]
            )
          : [
              [
                'No product sales recorded for the selected period.',
                '',
                '0',
                'Units',
                formatMoney(0),
                '0%',
              ],
            ];

      autoTable(doc, {
        startY: nextY,
        head: [
          [
            'Product Name',
            'Category',
            'Quantity Sold',
            'Unit',
            'Sales Value',
            '% of Total Sales',
          ],
        ],
        body: productBody,
        theme: 'grid',
        styles: {
          fontSize: 7.5,
          cellPadding: 2.3,
        },
        headStyles: {
          fillColor: [
            39,
            174,
            96,
          ],
          textColor: [
            255,
            255,
            255,
          ],
          fontStyle: 'bold',
        },
        margin: {
          left: 14,
          right: 14,
        },
      });

      nextY =
        (
          doc as any
        ).lastAutoTable.finalY +
        10;

      doc.setFontSize(11);

      doc.text(
        'SECTION 4: FINANCIAL CASH FLOW SUMMARY',
        14,
        nextY
      );

      nextY += 6;

      autoTable(doc, {
        startY: nextY,
        body: [
          [
            'Cash Inflows',
            formatMoney(
              inflowTotal
            ),
          ],
          [
            'Cash Outflows',
            formatMoney(
              cashFlowOutflow
            ),
          ],
          [
            'Net Cash Flow',
            formatMoney(
              netCashInflow
            ),
          ],
        ],
        theme: 'grid',
        styles: {
          fontSize: 9,
          cellPadding: 4,
        },
        columnStyles: {
          1: {
            halign: 'right',
          },
        },
        margin: {
          left: 14,
          right: 14,
        },
      });

      nextY =
        (
          doc as any
        ).lastAutoTable.finalY +
        10;

      doc.setFontSize(11);

      doc.text(
        'SECTION 5: PAYMENT CHANNEL ANALYSIS',
        14,
        nextY
      );

      nextY += 6;

      const paymentBody =
        paymentRows.length > 0
          ? paymentRows.map(
              (row) => [
                row.paymentMethod,
                String(
                  row.transactionCount
                ),
                formatMoney(
                  row.totalAmount
                ),
              ]
            )
          : [
              [
                'No payment activity recorded for the selected period.',
                '0',
                formatMoney(0),
              ],
            ];

      autoTable(doc, {
        startY: nextY,
        head: [
          [
            'Payment Method',
            'Transaction Count',
            'Total Amount',
          ],
        ],
        body: paymentBody,
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [
            234,
            88,
            12,
          ],
          textColor: [
            255,
            255,
            255,
          ],
          fontStyle: 'bold',
        },
        margin: {
          left: 14,
          right: 14,
        },
      });

      nextY =
        (
          doc as any
        ).lastAutoTable.finalY +
        10;

      doc.setFontSize(11);

      doc.text(
        'SECTION 6: DETAILED BUSINESS REGISTERS',
        14,
        nextY
      );

      nextY += 6;

      const registerBody = [
        [
          'Receipts',
          String(
            receiptRows.length
          ),
        ],
        [
          'Invoices',
          String(
            invoiceRows.length
          ),
        ],
        [
          'Credit Notes',
          String(
            creditNoteRows.length
          ),
        ],
        [
          'Deliveries',
          String(
            deliveryRows.length
          ),
        ],
        [
          'Expenses',
          String(
            expenseRows.length
          ),
        ],
      ];

      autoTable(doc, {
        startY: nextY,
        head: [
          ['Register', 'Records'],
        ],
        body: registerBody,
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [
            59,
            130,
            246,
          ],
          textColor: [
            255,
            255,
            255,
          ],
          fontStyle: 'bold',
        },
        margin: {
          left: 14,
          right: 14,
        },
      });

      const fileStem =
        businessName
          .toLowerCase()
          .replace(
            /[^a-z0-9]+/g,
            '-'
          )
          .replace(
            /^-+|-+$/g,
            ''
          ) ||
        'station';

      doc.save(
        `${fileStem}-reports-analytics-${selectedRange}.pdf`
      );
    } catch (error) {
      console.error(
        'PDF export failed:',
        error
      );

      setExportError(
        error instanceof Error
          ? error.message
          : 'PDF export failed.'
      );
    }
  };

  return (
    <div className="space-y-6 pb-12">

      {/* HEADER */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col gap-4">

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">

          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2 uppercase tracking-wide">
              <BarChart3 className="w-6 h-6 text-emerald-400" />

              {businessName}
            </h2>

            <p className="text-xs text-slate-400 mt-1">
              REPORTS & ANALYTICS · Financial
              Performance & Business Activity Report
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">

            <button
              type="button"
              onClick={() =>
                setSelectedRange(
                  'weekly'
                )
              }
              className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                selectedRange ===
                'weekly'
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700'
              }`}
            >
              Weekly
            </button>

            <button
              type="button"
              onClick={() =>
                setSelectedRange(
                  'monthly'
                )
              }
              className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                selectedRange ===
                'monthly'
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700'
              }`}
            >
              Monthly
            </button>

            <button
              type="button"
              onClick={() =>
                setSelectedRange(
                  'yearly'
                )
              }
              className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                selectedRange ===
                'yearly'
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700'
              }`}
            >
              Yearly
            </button>

            <button
              type="button"
              onClick={() =>
                setSelectedRange(
                  'custom'
                )
              }
              className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                selectedRange ===
                'custom'
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700'
              }`}
            >
              Custom
            </button>

          </div>
        </div>

        {selectedRange ===
          'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">

            <label className="text-xs text-slate-300">
              Start date

              <input
                type="date"
                value={customStart}
                onChange={(event) =>
                  setCustomStart(
                    event.target.value
                  )
                }
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
              />
            </label>

            <label className="text-xs text-slate-300">
              End date

              <input
                type="date"
                value={customEnd}
                onChange={(event) =>
                  setCustomEnd(
                    event.target.value
                  )
                }
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
              />
            </label>

          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">

          <button
            type="button"
            onClick={handlePrintReport}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-2"
          >
            <Printer className="w-4 h-4 text-emerald-400" />
            Print
          </button>

          <button
            type="button"
            onClick={exportPdf}
            className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl border border-rose-500 flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            Export PDF
          </button>

          <button
            type="button"
            onClick={exportExcel}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl border border-emerald-500 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>

        </div>
      </div>

      {/* EXPORT ERROR */}
      {exportError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200"
        >
          <strong>
            Export Error
          </strong>

          <div className="mt-1">
            {exportError}
          </div>
        </div>
      )}

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 font-mono">

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <span className="text-[11px] text-slate-400 block mb-1">
            TOTAL SALES
          </span>

          <div className="text-2xl font-black text-emerald-400">
            {formatMoney(
              totalRevenue
            )}
          </div>

          <div className="text-[11px] text-slate-400 mt-1">
            {formatMoney(
              fuelSales
            )}{' '}
            fuel •{' '}
            {formatMoney(
              shopSales
            )}{' '}
            retail
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <span className="text-[11px] text-slate-400 block mb-1">
            RECEIPTS
          </span>

          <div className="text-2xl font-black text-blue-400">
            {formatCount(
              receiptCount
            )}
          </div>

          <div className="text-[11px] text-slate-400 mt-1">
            {formatMoney(
              receiptRows.reduce(
                (sum, row) =>
                  sum + row.amount,
                0
              )
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <span className="text-[11px] text-slate-400 block mb-1">
            INVOICES
          </span>

          <div className="text-2xl font-black text-purple-400">
            {formatCount(
              invoiceCount
            )}
          </div>

          <div className="text-[11px] text-slate-400 mt-1">
            {formatMoney(
              invoiceRows.reduce(
                (sum, row) =>
                  sum + row.amount,
                0
              )
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <span className="text-[11px] text-slate-400 block mb-1">
            CREDIT NOTES
          </span>

          <div className="text-2xl font-black text-rose-400">
            {formatCount(
              creditNoteCount
            )}
          </div>

          <div className="text-[11px] text-slate-400 mt-1">
            {formatMoney(
              creditNoteTotal
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <span className="text-[11px] text-slate-400 block mb-1">
            EXPENSES
          </span>

          <div className="text-2xl font-black text-rose-400">
            {formatMoney(
              expenseTotal
            )}
          </div>

          <div className="text-[11px] text-slate-400 mt-1">
            {filteredAuditLogs.length}{' '}
            activity records
          </div>
        </div>

      </div>

      {/* SUMMARY */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">

          <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 pb-3 border-b border-slate-800">
            <PieChart className="w-5 h-5 text-emerald-400" />

            Document Volume & Value Mix
          </h3>

          <div className="mt-4 space-y-4">

            {documentSummary.map(
              (row) => (
                <div
                  key={row.label}
                  className="space-y-2"
                >

                  <div className="flex justify-between text-xs text-slate-200">

                    <span>
                      {row.label}
                    </span>

                    <span className="font-mono text-emerald-400">
                      {row.count} •{' '}
                      {formatMoney(
                        row.total
                      )}
                    </span>

                  </div>

                  <div className="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">

                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500"
                      style={{
                        width: `${Math.min(
                          ((row.total /
                            Math.max(
                              totalRevenue,
                              1
                            )) *
                            100) ||
                            0,
                          100
                        )}%`,
                      }}
                    />

                  </div>

                </div>
              )
            )}

          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">

          <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 pb-3 border-b border-slate-800">
            <Wallet className="w-5 h-5 text-purple-400" />

            Cash Flow & Activity Summary
          </h3>

          <div className="mt-4 space-y-3 text-xs font-mono">

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between">
              <span className="text-slate-400">
                Total Cash Inflow
              </span>

              <span className="text-emerald-400 font-bold">
                {formatMoney(
                  inflowTotal
                )}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between">
              <span className="text-slate-400">
                Fuel Sales
              </span>

              <span className="text-amber-400 font-bold">
                {formatMoney(
                  fuelSales
                )}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between">
              <span className="text-slate-400">
                Shop / Retail Sales
              </span>

              <span className="text-blue-400 font-bold">
                {formatMoney(
                  shopSales
                )}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between">
              <span className="text-slate-400">
                Credit Notes
              </span>

              <span className="text-rose-400 font-bold">
                {formatMoney(
                  creditNoteTotal
                )}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between">
              <span className="text-slate-400">
                Expenses
              </span>

              <span className="text-rose-400 font-bold">
                {formatMoney(
                  expenseTotal
                )}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between">
              <span className="text-slate-400">
                Net Cash Flow
              </span>

              <span className="text-cyan-400 font-bold">
                {formatMoney(
                  netCashInflow
                )}
              </span>
            </div>

          </div>
        </div>

      </div>

      {/* PAYMENT CHANNEL */}
      <div className="grid grid-cols-1 gap-6">

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">

          <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 pb-3 border-b border-slate-800">
            <Activity className="w-5 h-5 text-emerald-400" />

            Payment Channel Split
          </h3>

          <div className="mt-4 space-y-3 font-mono text-xs">

            {Object.entries(
              paymentBreakdown
            ).length > 0 ? (
              Object.entries(
                paymentBreakdown
              ).map(
                ([
                  method,
                  amount,
                ]) => {
                  const pct =
                    totalRevenue >
                    0
                      ? (amount /
                          totalRevenue) *
                        100
                      : 0;

                  return (
                    <div
                      key={method}
                      className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2"
                    >

                      <div className="flex justify-between">

                        <span>
                          {method}
                        </span>

                        <span className="text-emerald-400">
                          {formatMoney(
                            amount
                          )}{' '}
                          (
                          {pct.toFixed(
                            1
                          )}
                          %)
                        </span>

                      </div>

                      <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden">

                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{
                            width: `${Math.min(
                              pct,
                              100
                            )}%`,
                          }}
                        />

                      </div>

                    </div>
                  );
                }
              )
            ) : (
              <div className="text-xs text-slate-400">
                No payment data in this
                range.
              </div>
            )}

          </div>
        </div>
      </div>

    </div>
  );
};