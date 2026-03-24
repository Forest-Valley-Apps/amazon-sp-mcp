import { z } from 'zod';
import { getConfig } from '../../config/index.js';
import { requestAndDownloadReport } from '../../utils/report-poller.js';
import { parseCSV } from '../../utils/csv-parser.js';
import { REPORT_TYPES } from '../../types/sp-api.js';

// Input schema
const getSettlementReportSchema = z.object({
  startDate: z.string().describe('Start date in YYYY-MM-DD format'),
  endDate: z.string().describe('End date in YYYY-MM-DD format'),
});

// Settlement record type (flat file format)
interface SettlementRecord {
  settlement_id: string;
  settlement_start_date: string;
  settlement_end_date: string;
  deposit_date: string;
  total_amount: string;
  currency: string;
  transaction_type: string;
  order_id: string;
  merchant_order_id: string;
  adjustment_id: string;
  shipment_id: string;
  marketplace_name: string;
  amount_type: string;
  amount_description: string;
  amount: string;
  fulfillment_id: string;
  posted_date: string;
  posted_date_time: string;
  order_item_code: string;
  merchant_order_item_id: string;
  merchant_adjustment_item_id: string;
  sku: string;
  quantity_purchased: string;
  promotion_id: string;
}

export const settlementTools = [
  {
    name: 'get_settlement_report',
    description:
      'Get settlement report showing payment disbursements, including order sales, refunds, fees, and other charges. Provides detailed breakdown of what Amazon paid and deducted.',
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
      const input = getSettlementReportSchema.parse(params);
      const config = getConfig();

      // Request and download the report
      const { data } = await requestAndDownloadReport(REPORT_TYPES.SETTLEMENT_FLAT_FILE, {
        dataStartTime: `${input.startDate}T00:00:00Z`,
        dataEndTime: `${input.endDate}T23:59:59Z`,
        marketplaceIds: [config.MARKETPLACE_ID],
        pollOptions: {
          maxWaitMs: 300000,
          pollIntervalMs: 15000,
        },
      });

      // Parse the CSV data
      const records = parseCSV<SettlementRecord>(data, { delimiter: '\t' });

      // Group by transaction type
      const byTransactionType = records.reduce(
        (acc, r) => {
          const type = r.transaction_type || 'Other';
          if (!acc[type]) {
            acc[type] = { count: 0, amount: 0 };
          }
          acc[type].count++;
          acc[type].amount += parseFloat(r.amount) || 0;
          return acc;
        },
        {} as Record<string, { count: number; amount: number }>
      );

      // Group by amount type (Principal, FBA fees, Commission, etc.)
      const byAmountType = records.reduce(
        (acc, r) => {
          const type = r.amount_type || 'Other';
          if (!acc[type]) {
            acc[type] = { count: 0, amount: 0 };
          }
          acc[type].count++;
          acc[type].amount += parseFloat(r.amount) || 0;
          return acc;
        },
        {} as Record<string, { count: number; amount: number }>
      );

      // Calculate totals
      const totalPositive = records
        .filter((r) => parseFloat(r.amount) > 0)
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);

      const totalNegative = records
        .filter((r) => parseFloat(r.amount) < 0)
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);

      const netAmount = totalPositive + totalNegative;
      const currency = records[0]?.currency || 'USD';

      // Get unique settlement IDs
      const settlementIds = [...new Set(records.map((r) => r.settlement_id).filter(Boolean))];

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                summary: {
                  dateRange: { start: input.startDate, end: input.endDate },
                  settlementCount: settlementIds.length,
                  totalTransactions: records.length,
                  currency,
                  totalCredits: totalPositive.toFixed(2),
                  totalDebits: totalNegative.toFixed(2),
                  netAmount: netAmount.toFixed(2),
                },
                byTransactionType: Object.entries(byTransactionType)
                  .map(([type, data]) => ({
                    type,
                    count: data.count,
                    amount: data.amount.toFixed(2),
                  }))
                  .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)),
                byAmountType: Object.entries(byAmountType)
                  .map(([type, data]) => ({
                    type,
                    count: data.count,
                    amount: data.amount.toFixed(2),
                  }))
                  .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)),
                settlementIds,
                recentTransactions: records.slice(0, 50).map((r) => ({
                  settlementId: r.settlement_id,
                  postedDate: r.posted_date,
                  transactionType: r.transaction_type,
                  amountType: r.amount_type,
                  amountDescription: r.amount_description,
                  amount: r.amount,
                  orderId: r.order_id,
                  sku: r.sku,
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
