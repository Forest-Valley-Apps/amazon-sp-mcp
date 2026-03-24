import { z } from 'zod';
import { getConfig } from '../../config/index.js';
import { requestAndDownloadReport } from '../../utils/report-poller.js';
import { parseCSV } from '../../utils/csv-parser.js';
import { REPORT_TYPES } from '../../types/sp-api.js';

// Input schemas
const getFbaFeeEstimatesSchema = z.object({
  // No date range needed - this is a point-in-time snapshot
});

const getStorageFeesSchema = z.object({
  startDate: z.string().describe('Start date in YYYY-MM-DD format'),
  endDate: z.string().describe('End date in YYYY-MM-DD format'),
});

// Fee estimate record type
interface FeeEstimateRecord {
  sku: string;
  fnsku: string;
  asin: string;
  product_name: string;
  product_group: string;
  brand: string;
  fulfilled_by: string;
  has_local_inventory: string;
  your_price: string;
  sales_price: string;
  longest_side: string;
  median_side: string;
  shortest_side: string;
  length_and_girth: string;
  unit_of_dimension: string;
  item_package_weight: string;
  unit_of_weight: string;
  product_size_tier: string;
  currency: string;
  estimated_fee_total: string;
  estimated_referral_fee_per_unit: string;
  estimated_variable_closing_fee: string;
  estimated_order_handling_fee_per_order: string;
  estimated_pick_pack_fee_per_unit: string;
  estimated_weight_handling_fee_per_unit: string;
  expected_fulfillment_fee_per_unit: string;
}

// Storage fee record type
interface StorageFeeRecord {
  asin: string;
  fnsku: string;
  product_name: string;
  fulfillment_center: string;
  country_code: string;
  longest_side: string;
  median_side: string;
  shortest_side: string;
  measurement_units: string;
  weight: string;
  weight_units: string;
  item_volume: string;
  volume_units: string;
  product_size_tier: string;
  average_quantity_on_hand: string;
  average_quantity_pending_removal: string;
  estimated_total_item_volume: string;
  month_of_charge: string;
  storage_utilization_ratio: string;
  storage_utilization_ratio_units: string;
  base_rate: string;
  utilization_surcharge_rate: string;
  currency: string;
  estimated_monthly_storage_fee: string;
  dangerous_goods_storage_type: string;
  eligible_for_inventory_discount: string;
  qualifies_for_inventory_discount: string;
}

// Long-term storage fee record type
interface LongTermStorageFeeRecord {
  snapshot_date: string;
  sku: string;
  fnsku: string;
  asin: string;
  product_name: string;
  condition: string;
  per_unit_volume: string;
  currency: string;
  qty_charged_12_mo_long_term_storage_fee: string;
  '12_mo_long_terms_storage_fee': string;
  qty_charged_6_mo_long_term_storage_fee: string;
  '6_mo_long_terms_storage_fee': string;
  surcharge_age_tier: string;
  volume_unit: string;
}

export const feeTools = [
  {
    name: 'get_fba_fee_estimates',
    description:
      'Get estimated FBA fees per SKU including referral fees, fulfillment fees, and other charges. Helpful for understanding per-unit costs and profitability analysis.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (params: unknown) => {
      getFbaFeeEstimatesSchema.parse(params);
      const config = getConfig();

      // Request and download the report
      const { data } = await requestAndDownloadReport(REPORT_TYPES.FBA_FEE_ESTIMATES, {
        marketplaceIds: [config.MARKETPLACE_ID],
        pollOptions: {
          maxWaitMs: 300000,
          pollIntervalMs: 15000,
        },
      });

      // Parse the CSV data
      const records = parseCSV<FeeEstimateRecord>(data, { delimiter: '\t' });

      // Calculate summary statistics
      const totalEstimatedFees = records.reduce(
        (sum, r) => sum + (parseFloat(r.estimated_fee_total) || 0),
        0
      );

      const byProductSizeTier = records.reduce(
        (acc, r) => {
          const tier = r.product_size_tier || 'Unknown';
          if (!acc[tier]) {
            acc[tier] = { count: 0, avgFee: 0, totalFee: 0 };
          }
          acc[tier].count++;
          acc[tier].totalFee += parseFloat(r.estimated_fee_total) || 0;
          return acc;
        },
        {} as Record<string, { count: number; avgFee: number; totalFee: number }>
      );

      // Calculate averages
      Object.values(byProductSizeTier).forEach((tier) => {
        tier.avgFee = tier.count > 0 ? tier.totalFee / tier.count : 0;
      });

      const currency = records[0]?.currency || 'USD';

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                summary: {
                  totalSkus: records.length,
                  currency,
                  totalEstimatedFees: totalEstimatedFees.toFixed(2),
                  averageFeePerSku:
                    records.length > 0 ? (totalEstimatedFees / records.length).toFixed(2) : '0.00',
                },
                byProductSizeTier: Object.entries(byProductSizeTier)
                  .map(([tier, data]) => ({
                    tier,
                    skuCount: data.count,
                    averageFee: data.avgFee.toFixed(2),
                    totalFee: data.totalFee.toFixed(2),
                  }))
                  .sort((a, b) => parseFloat(b.totalFee) - parseFloat(a.totalFee)),
                feeEstimates: records.slice(0, 50).map((r) => ({
                  sku: r.sku,
                  asin: r.asin,
                  productName: r.product_name,
                  productSizeTier: r.product_size_tier,
                  yourPrice: r.your_price,
                  estimatedFeeTotal: r.estimated_fee_total,
                  feeBreakdown: {
                    referralFee: r.estimated_referral_fee_per_unit,
                    fulfillmentFee: r.expected_fulfillment_fee_per_unit,
                    pickPackFee: r.estimated_pick_pack_fee_per_unit,
                    weightHandlingFee: r.estimated_weight_handling_fee_per_unit,
                    variableClosingFee: r.estimated_variable_closing_fee,
                  },
                  dimensions: {
                    longest: r.longest_side,
                    median: r.median_side,
                    shortest: r.shortest_side,
                    unit: r.unit_of_dimension,
                  },
                  weight: {
                    value: r.item_package_weight,
                    unit: r.unit_of_weight,
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
  {
    name: 'get_storage_fees',
    description:
      'Get FBA monthly storage fee charges by SKU. Shows storage costs, volume, and utilization for each product in Amazon fulfillment centers.',
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
      const input = getStorageFeesSchema.parse(params);
      const config = getConfig();

      // Request and download the report
      const { data } = await requestAndDownloadReport(REPORT_TYPES.FBA_STORAGE_FEES, {
        dataStartTime: `${input.startDate}T00:00:00Z`,
        dataEndTime: `${input.endDate}T23:59:59Z`,
        marketplaceIds: [config.MARKETPLACE_ID],
        pollOptions: {
          maxWaitMs: 300000,
          pollIntervalMs: 15000,
        },
      });

      // Parse the CSV data
      const records = parseCSV<StorageFeeRecord>(data, { delimiter: '\t' });

      // Calculate summary statistics
      const totalStorageFees = records.reduce(
        (sum, r) => sum + (parseFloat(r.estimated_monthly_storage_fee) || 0),
        0
      );

      const totalVolume = records.reduce(
        (sum, r) => sum + (parseFloat(r.estimated_total_item_volume) || 0),
        0
      );

      const byProductSizeTier = records.reduce(
        (acc, r) => {
          const tier = r.product_size_tier || 'Unknown';
          if (!acc[tier]) {
            acc[tier] = { count: 0, totalFee: 0, totalVolume: 0 };
          }
          acc[tier].count++;
          acc[tier].totalFee += parseFloat(r.estimated_monthly_storage_fee) || 0;
          acc[tier].totalVolume += parseFloat(r.estimated_total_item_volume) || 0;
          return acc;
        },
        {} as Record<string, { count: number; totalFee: number; totalVolume: number }>
      );

      const currency = records[0]?.currency || 'USD';

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                summary: {
                  dateRange: { start: input.startDate, end: input.endDate },
                  totalSkus: records.length,
                  currency,
                  totalStorageFees: totalStorageFees.toFixed(2),
                  totalVolume: totalVolume.toFixed(2),
                },
                byProductSizeTier: Object.entries(byProductSizeTier)
                  .map(([tier, data]) => ({
                    tier,
                    skuCount: data.count,
                    totalFee: data.totalFee.toFixed(2),
                    totalVolume: data.totalVolume.toFixed(2),
                  }))
                  .sort((a, b) => parseFloat(b.totalFee) - parseFloat(a.totalFee)),
                storageFees: records
                  .sort(
                    (a, b) =>
                      parseFloat(b.estimated_monthly_storage_fee) -
                      parseFloat(a.estimated_monthly_storage_fee)
                  )
                  .slice(0, 50)
                  .map((r) => ({
                    asin: r.asin,
                    fnsku: r.fnsku,
                    productName: r.product_name,
                    productSizeTier: r.product_size_tier,
                    avgQuantityOnHand: r.average_quantity_on_hand,
                    estimatedVolume: r.estimated_total_item_volume,
                    volumeUnits: r.volume_units,
                    monthOfCharge: r.month_of_charge,
                    storageUtilizationRatio: r.storage_utilization_ratio,
                    baseRate: r.base_rate,
                    estimatedMonthlyStorageFee: r.estimated_monthly_storage_fee,
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
    name: 'get_longterm_storage_fees',
    description:
      'Get long-term storage fees (LTSF) for inventory stored over 365 days. Shows aged inventory charges to help identify products incurring extra storage costs.',
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
      const input = getStorageFeesSchema.parse(params);
      const config = getConfig();

      // Request and download the report
      const { data } = await requestAndDownloadReport(REPORT_TYPES.FBA_LONGTERM_STORAGE_FEES, {
        dataStartTime: `${input.startDate}T00:00:00Z`,
        dataEndTime: `${input.endDate}T23:59:59Z`,
        marketplaceIds: [config.MARKETPLACE_ID],
        pollOptions: {
          maxWaitMs: 300000,
          pollIntervalMs: 15000,
        },
      });

      // Parse the CSV data
      const records = parseCSV<LongTermStorageFeeRecord>(data, { delimiter: '\t' });

      // Calculate summary statistics
      const total12MonthFees = records.reduce(
        (sum, r) => sum + (parseFloat(r['12_mo_long_terms_storage_fee']) || 0),
        0
      );

      const total6MonthFees = records.reduce(
        (sum, r) => sum + (parseFloat(r['6_mo_long_terms_storage_fee']) || 0),
        0
      );

      const totalAgedUnits12Mo = records.reduce(
        (sum, r) => sum + (parseInt(r.qty_charged_12_mo_long_term_storage_fee) || 0),
        0
      );

      const totalAgedUnits6Mo = records.reduce(
        (sum, r) => sum + (parseInt(r.qty_charged_6_mo_long_term_storage_fee) || 0),
        0
      );

      const currency = records[0]?.currency || 'USD';

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                summary: {
                  dateRange: { start: input.startDate, end: input.endDate },
                  totalSkusWithLTSF: records.length,
                  currency,
                  total12MonthFees: total12MonthFees.toFixed(2),
                  total6MonthFees: total6MonthFees.toFixed(2),
                  totalFees: (total12MonthFees + total6MonthFees).toFixed(2),
                  totalAgedUnits12Mo,
                  totalAgedUnits6Mo,
                },
                ltsfDetails: records
                  .sort(
                    (a, b) =>
                      parseFloat(b['12_mo_long_terms_storage_fee'] || '0') +
                      parseFloat(b['6_mo_long_terms_storage_fee'] || '0') -
                      (parseFloat(a['12_mo_long_terms_storage_fee'] || '0') +
                        parseFloat(a['6_mo_long_terms_storage_fee'] || '0'))
                  )
                  .slice(0, 50)
                  .map((r) => ({
                    snapshotDate: r.snapshot_date,
                    sku: r.sku,
                    asin: r.asin,
                    productName: r.product_name,
                    condition: r.condition,
                    surchargeAgeTier: r.surcharge_age_tier,
                    perUnitVolume: r.per_unit_volume,
                    volumeUnit: r.volume_unit,
                    charges12Month: {
                      quantity: r.qty_charged_12_mo_long_term_storage_fee,
                      fee: r['12_mo_long_terms_storage_fee'],
                    },
                    charges6Month: {
                      quantity: r.qty_charged_6_mo_long_term_storage_fee,
                      fee: r['6_mo_long_terms_storage_fee'],
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
