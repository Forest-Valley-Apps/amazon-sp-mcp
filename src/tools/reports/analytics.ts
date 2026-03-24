import { z } from 'zod';
import { getConfig } from '../../config/index.js';
import { requestAndDownloadReport } from '../../utils/report-poller.js';
import { parseCSV } from '../../utils/csv-parser.js';
import { REPORT_TYPES } from '../../types/sp-api.js';

// Input schemas
const getSalesTrafficSchema = z.object({
  startDate: z.string().describe('Start date in YYYY-MM-DD format'),
  endDate: z.string().describe('End date in YYYY-MM-DD format'),
  reportOptions: z
    .object({
      dateGranularity: z.enum(['DAY', 'WEEK', 'MONTH']).optional().default('DAY'),
      asinGranularity: z.enum(['PARENT', 'CHILD', 'SKU']).optional().default('PARENT'),
    })
    .optional(),
});

const getBrandAnalyticsSchema = z.object({
  startDate: z.string().describe('Start date in YYYY-MM-DD format'),
  endDate: z.string().describe('End date in YYYY-MM-DD format'),
});

const getInventoryLedgerSchema = z.object({
  startDate: z.string().describe('Start date in YYYY-MM-DD format'),
  endDate: z.string().describe('End date in YYYY-MM-DD format'),
});

// Sales & Traffic report record type
interface SalesTrafficRecord {
  date: string;
  parent_asin: string;
  child_asin: string;
  sku: string;
  title: string;
  sessions: string;
  session_percentage: string;
  page_views: string;
  page_views_percentage: string;
  buy_box_percentage: string;
  units_ordered: string;
  units_ordered_b2b: string;
  unit_session_percentage: string;
  unit_session_percentage_b2b: string;
  ordered_product_sales: string;
  ordered_product_sales_b2b: string;
  total_order_items: string;
  total_order_items_b2b: string;
}

// Brand Analytics Search Terms record type
interface SearchTermsRecord {
  reporting_date: string;
  search_term: string;
  search_frequency_rank: string;
  clicked_asin_1: string;
  clicked_asin_1_product_title: string;
  clicked_asin_1_click_share: string;
  clicked_asin_1_conversion_share: string;
  clicked_asin_2: string;
  clicked_asin_2_product_title: string;
  clicked_asin_2_click_share: string;
  clicked_asin_2_conversion_share: string;
  clicked_asin_3: string;
  clicked_asin_3_product_title: string;
  clicked_asin_3_click_share: string;
  clicked_asin_3_conversion_share: string;
}

// Inventory Ledger record type
interface InventoryLedgerRecord {
  date: string;
  fnsku: string;
  asin: string;
  msku: string;
  title: string;
  disposition: string;
  starting_warehouse_balance: string;
  in_transit_between_warehouses: string;
  receipts: string;
  customer_shipments: string;
  customer_returns: string;
  vendor_returns: string;
  warehouse_transfer_in_out: string;
  found: string;
  lost: string;
  damaged: string;
  disposed: string;
  other_events: string;
  ending_warehouse_balance: string;
  unknown_events: string;
}

export const analyticsTools = [
  {
    name: 'get_sales_traffic_report',
    description:
      'Get detailed sales and traffic data including sessions, page views, conversion rate (unit session percentage), buy box percentage, and sales by ASIN. Essential for understanding product performance and conversion optimization.',
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
        reportOptions: {
          type: 'object',
          properties: {
            dateGranularity: {
              type: 'string',
              enum: ['DAY', 'WEEK', 'MONTH'],
              description: 'Time granularity for the data',
              default: 'DAY',
            },
            asinGranularity: {
              type: 'string',
              enum: ['PARENT', 'CHILD', 'SKU'],
              description: 'Product granularity level',
              default: 'PARENT',
            },
          },
        },
      },
      required: ['startDate', 'endDate'],
    },
    handler: async (params: unknown) => {
      const input = getSalesTrafficSchema.parse(params);
      const config = getConfig();

      const reportOptions: Record<string, string> = {
        dateGranularity: input.reportOptions?.dateGranularity || 'DAY',
        asinGranularity: input.reportOptions?.asinGranularity || 'PARENT',
      };

      // Request and download the report
      const { data } = await requestAndDownloadReport(REPORT_TYPES.SALES_TRAFFIC, {
        dataStartTime: `${input.startDate}T00:00:00Z`,
        dataEndTime: `${input.endDate}T23:59:59Z`,
        marketplaceIds: [config.MARKETPLACE_ID],
        reportOptions,
        pollOptions: {
          maxWaitMs: 300000,
          pollIntervalMs: 15000,
        },
      });

      // Parse the CSV data
      const records = parseCSV<SalesTrafficRecord>(data, { delimiter: '\t' });

      // Calculate summary statistics
      const totalSessions = records.reduce((sum, r) => sum + (parseInt(r.sessions) || 0), 0);
      const totalPageViews = records.reduce((sum, r) => sum + (parseInt(r.page_views) || 0), 0);
      const totalUnitsOrdered = records.reduce(
        (sum, r) => sum + (parseInt(r.units_ordered) || 0),
        0
      );
      const totalSales = records.reduce(
        (sum, r) => sum + (parseFloat(r.ordered_product_sales) || 0),
        0
      );

      const avgConversionRate =
        totalSessions > 0 ? ((totalUnitsOrdered / totalSessions) * 100).toFixed(2) : '0.00';

      // Get top performing products
      const byAsin = records.reduce(
        (acc, r) => {
          const asin = r.parent_asin || r.child_asin || 'Unknown';
          if (!acc[asin]) {
            acc[asin] = {
              title: r.title,
              sessions: 0,
              pageViews: 0,
              unitsOrdered: 0,
              sales: 0,
              avgBuyBox: 0,
              count: 0,
            };
          }
          acc[asin].sessions += parseInt(r.sessions) || 0;
          acc[asin].pageViews += parseInt(r.page_views) || 0;
          acc[asin].unitsOrdered += parseInt(r.units_ordered) || 0;
          acc[asin].sales += parseFloat(r.ordered_product_sales) || 0;
          acc[asin].avgBuyBox += parseFloat(r.buy_box_percentage) || 0;
          acc[asin].count++;
          return acc;
        },
        {} as Record<
          string,
          {
            title: string;
            sessions: number;
            pageViews: number;
            unitsOrdered: number;
            sales: number;
            avgBuyBox: number;
            count: number;
          }
        >
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                summary: {
                  dateRange: { start: input.startDate, end: input.endDate },
                  granularity: reportOptions,
                  totalSessions,
                  totalPageViews,
                  totalUnitsOrdered,
                  totalSales: totalSales.toFixed(2),
                  averageConversionRate: `${avgConversionRate}%`,
                },
                topProducts: Object.entries(byAsin)
                  .map(([asin, data]) => ({
                    asin,
                    title: data.title,
                    sessions: data.sessions,
                    pageViews: data.pageViews,
                    unitsOrdered: data.unitsOrdered,
                    sales: data.sales.toFixed(2),
                    conversionRate:
                      data.sessions > 0
                        ? ((data.unitsOrdered / data.sessions) * 100).toFixed(2) + '%'
                        : '0.00%',
                    avgBuyBoxPercentage:
                      data.count > 0 ? (data.avgBuyBox / data.count).toFixed(2) + '%' : '0.00%',
                  }))
                  .sort((a, b) => parseFloat(b.sales) - parseFloat(a.sales))
                  .slice(0, 20),
                dailyData: records.slice(0, 30).map((r) => ({
                  date: r.date,
                  asin: r.parent_asin || r.child_asin,
                  title: r.title,
                  sessions: r.sessions,
                  pageViews: r.page_views,
                  buyBoxPercentage: r.buy_box_percentage,
                  unitsOrdered: r.units_ordered,
                  unitSessionPercentage: r.unit_session_percentage,
                  orderedProductSales: r.ordered_product_sales,
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
  {
    name: 'get_search_terms_report',
    description:
      'Get Brand Analytics search term report showing top search terms, search frequency rank, and click/conversion share by ASIN. Requires Brand Registry. Helps understand how customers find your products.',
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
      const input = getBrandAnalyticsSchema.parse(params);
      const config = getConfig();

      // Request and download the report
      const { data } = await requestAndDownloadReport(REPORT_TYPES.BRAND_ANALYTICS_SEARCH_TERMS, {
        dataStartTime: `${input.startDate}T00:00:00Z`,
        dataEndTime: `${input.endDate}T23:59:59Z`,
        marketplaceIds: [config.MARKETPLACE_ID],
        pollOptions: {
          maxWaitMs: 300000,
          pollIntervalMs: 15000,
        },
      });

      // Parse the CSV data
      const records = parseCSV<SearchTermsRecord>(data, { delimiter: '\t' });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                summary: {
                  dateRange: { start: input.startDate, end: input.endDate },
                  totalSearchTerms: records.length,
                },
                searchTerms: records.slice(0, 100).map((r) => ({
                  reportingDate: r.reporting_date,
                  searchTerm: r.search_term,
                  searchFrequencyRank: r.search_frequency_rank,
                  topClickedAsins: [
                    r.clicked_asin_1 && {
                      asin: r.clicked_asin_1,
                      title: r.clicked_asin_1_product_title,
                      clickShare: r.clicked_asin_1_click_share,
                      conversionShare: r.clicked_asin_1_conversion_share,
                    },
                    r.clicked_asin_2 && {
                      asin: r.clicked_asin_2,
                      title: r.clicked_asin_2_product_title,
                      clickShare: r.clicked_asin_2_click_share,
                      conversionShare: r.clicked_asin_2_conversion_share,
                    },
                    r.clicked_asin_3 && {
                      asin: r.clicked_asin_3,
                      title: r.clicked_asin_3_product_title,
                      clickShare: r.clicked_asin_3_click_share,
                      conversionShare: r.clicked_asin_3_conversion_share,
                    },
                  ].filter(Boolean),
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
  {
    name: 'get_inventory_ledger',
    description:
      'Get inventory ledger summary showing inventory movements including receipts, shipments, returns, adjustments, and balance changes over time. Helps track where inventory went.',
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
      const input = getInventoryLedgerSchema.parse(params);
      const config = getConfig();

      // Request and download the report
      const { data } = await requestAndDownloadReport(REPORT_TYPES.FBA_INVENTORY_LEDGER_SUMMARY, {
        dataStartTime: `${input.startDate}T00:00:00Z`,
        dataEndTime: `${input.endDate}T23:59:59Z`,
        marketplaceIds: [config.MARKETPLACE_ID],
        pollOptions: {
          maxWaitMs: 300000,
          pollIntervalMs: 15000,
        },
      });

      // Parse the CSV data
      const records = parseCSV<InventoryLedgerRecord>(data, { delimiter: '\t' });

      // Calculate summary statistics
      const totals = records.reduce(
        (acc, r) => ({
          receipts: acc.receipts + (parseInt(r.receipts) || 0),
          customerShipments: acc.customerShipments + (parseInt(r.customer_shipments) || 0),
          customerReturns: acc.customerReturns + (parseInt(r.customer_returns) || 0),
          lost: acc.lost + (parseInt(r.lost) || 0),
          damaged: acc.damaged + (parseInt(r.damaged) || 0),
          disposed: acc.disposed + (parseInt(r.disposed) || 0),
          found: acc.found + (parseInt(r.found) || 0),
        }),
        {
          receipts: 0,
          customerShipments: 0,
          customerReturns: 0,
          lost: 0,
          damaged: 0,
          disposed: 0,
          found: 0,
        }
      );

      // Group by ASIN
      const byAsin = records.reduce(
        (acc, r) => {
          const asin = r.asin || 'Unknown';
          if (!acc[asin]) {
            acc[asin] = {
              title: r.title,
              startingBalance: 0,
              endingBalance: 0,
              receipts: 0,
              shipments: 0,
              returns: 0,
              adjustments: 0,
            };
          }
          acc[asin].startingBalance += parseInt(r.starting_warehouse_balance) || 0;
          acc[asin].endingBalance += parseInt(r.ending_warehouse_balance) || 0;
          acc[asin].receipts += parseInt(r.receipts) || 0;
          acc[asin].shipments += parseInt(r.customer_shipments) || 0;
          acc[asin].returns += parseInt(r.customer_returns) || 0;
          acc[asin].adjustments +=
            (parseInt(r.found) || 0) -
            (parseInt(r.lost) || 0) -
            (parseInt(r.damaged) || 0) -
            (parseInt(r.disposed) || 0);
          return acc;
        },
        {} as Record<
          string,
          {
            title: string;
            startingBalance: number;
            endingBalance: number;
            receipts: number;
            shipments: number;
            returns: number;
            adjustments: number;
          }
        >
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                summary: {
                  dateRange: { start: input.startDate, end: input.endDate },
                  totalSkus: Object.keys(byAsin).length,
                  totals,
                },
                byAsin: Object.entries(byAsin)
                  .map(([asin, data]) => ({
                    asin,
                    title: data.title,
                    startingBalance: data.startingBalance,
                    endingBalance: data.endingBalance,
                    receipts: data.receipts,
                    shipments: data.shipments,
                    returns: data.returns,
                    netAdjustments: data.adjustments,
                  }))
                  .sort((a, b) => b.shipments - a.shipments)
                  .slice(0, 30),
                ledgerDetails: records.slice(0, 50).map((r) => ({
                  date: r.date,
                  asin: r.asin,
                  fnsku: r.fnsku,
                  sku: r.msku,
                  title: r.title,
                  disposition: r.disposition,
                  startingBalance: r.starting_warehouse_balance,
                  endingBalance: r.ending_warehouse_balance,
                  movements: {
                    receipts: r.receipts,
                    customerShipments: r.customer_shipments,
                    customerReturns: r.customer_returns,
                    found: r.found,
                    lost: r.lost,
                    damaged: r.damaged,
                    disposed: r.disposed,
                    other: r.other_events,
                  },
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
