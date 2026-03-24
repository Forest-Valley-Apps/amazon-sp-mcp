import { z } from 'zod';
import { getConfig } from '../../config/index.js';
import { requestAndDownloadReport } from '../../utils/report-poller.js';
import { parseCSV } from '../../utils/csv-parser.js';
import { REPORT_TYPES } from '../../types/sp-api.js';

// Input schema
const getReimbursementsSchema = z.object({
  startDate: z.string().describe('Start date in YYYY-MM-DD format'),
  endDate: z.string().describe('End date in YYYY-MM-DD format'),
});

// Reimbursement record type
interface ReimbursementRecord {
  approval_date: string;
  reimbursement_id: string;
  case_id: string;
  amazon_order_id: string;
  reason: string;
  sku: string;
  fnsku: string;
  asin: string;
  product_name: string;
  condition: string;
  currency_unit: string;
  amount_per_unit: string;
  amount_total: string;
  quantity_reimbursed_cash: string;
  quantity_reimbursed_inventory: string;
  quantity_reimbursed_total: string;
  original_reimbursement_id: string;
  original_reimbursement_type: string;
}

export const reimbursementTools = [
  {
    name: 'get_fba_reimbursements',
    description:
      'Get FBA reimbursements for lost, damaged, or returned inventory within a date range. Shows reimbursement amounts, reasons, and affected products. Useful for tracking Amazon credits for inventory issues.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
      },
      required: ['startDate', 'endDate'],
    },
    handler: async (params: unknown) => {
      const input = getReimbursementsSchema.parse(params);
      const config = getConfig();

      // Request and download the report
      const { data } = await requestAndDownloadReport(REPORT_TYPES.FBA_REIMBURSEMENTS, {
        dataStartTime: `${input.startDate}T00:00:00Z`,
        dataEndTime: `${input.endDate}T23:59:59Z`,
        marketplaceIds: [config.MARKETPLACE_ID],
        pollOptions: {
          maxWaitMs: 300000, // 5 minutes
          pollIntervalMs: 15000, // 15 seconds
        },
      });

      // Parse the CSV data
      const records = parseCSV<ReimbursementRecord>(data, { delimiter: '\t' });

      // Calculate summary statistics
      const totalAmount = records.reduce(
        (sum, r) => sum + (parseFloat(r.amount_total) || 0),
        0
      );

      const byReason = records.reduce(
        (acc, r) => {
          const reason = r.reason || 'Unknown';
          if (!acc[reason]) {
            acc[reason] = { count: 0, amount: 0 };
          }
          acc[reason].count++;
          acc[reason].amount += parseFloat(r.amount_total) || 0;
          return acc;
        },
        {} as Record<string, { count: number; amount: number }>
      );

      const bySku = records.reduce(
        (acc, r) => {
          const sku = r.sku || 'Unknown';
          if (!acc[sku]) {
            acc[sku] = { count: 0, amount: 0, productName: r.product_name };
          }
          acc[sku].count++;
          acc[sku].amount += parseFloat(r.amount_total) || 0;
          return acc;
        },
        {} as Record<string, { count: number; amount: number; productName: string }>
      );

      const currency = records[0]?.currency_unit || 'USD';

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                summary: {
                  dateRange: { start: input.startDate, end: input.endDate },
                  totalReimbursements: records.length,
                  totalAmount: {
                    amount: totalAmount.toFixed(2),
                    currencyCode: currency,
                  },
                },
                byReason: Object.entries(byReason)
                  .map(([reason, data]) => ({
                    reason,
                    count: data.count,
                    amount: data.amount.toFixed(2),
                  }))
                  .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)),
                bySku: Object.entries(bySku)
                  .map(([sku, data]) => ({
                    sku,
                    productName: data.productName,
                    count: data.count,
                    amount: data.amount.toFixed(2),
                  }))
                  .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
                  .slice(0, 20), // Top 20 SKUs
                recentReimbursements: records.slice(0, 50).map((r) => ({
                  reimbursementId: r.reimbursement_id,
                  approvalDate: r.approval_date,
                  reason: r.reason,
                  sku: r.sku,
                  asin: r.asin,
                  productName: r.product_name,
                  quantity: r.quantity_reimbursed_total,
                  amount: r.amount_total,
                  amazonOrderId: r.amazon_order_id,
                  caseId: r.case_id,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    },
  },
];
