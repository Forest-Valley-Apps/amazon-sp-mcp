import { z } from 'zod';
import { getSPAPIClient } from '../client/sp-api-client.js';
import { getConfig } from '../config/index.js';
import type { GetInventorySummariesResponse } from '../types/sp-api.js';

// Input schemas
const getInventorySummarySchema = z.object({
  sellerSkus: z
    .array(z.string())
    .optional()
    .describe('Filter by specific seller SKUs (max 50)'),
  nextToken: z.string().optional().describe('Pagination token for next page of results'),
});

const getFbaInventorySchema = z.object({
  sellerSku: z.string().optional().describe('Filter by specific seller SKU'),
  asin: z.string().optional().describe('Filter by specific ASIN'),
});

// Tool definitions
export const inventoryTools = [
  {
    name: 'get_inventory_summary',
    description:
      'Get FBA inventory summary including quantity available, reserved, inbound, and unfulfillable. Shows inventory health at a glance for all or specific SKUs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sellerSkus: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by specific seller SKUs (max 50)',
        },
        nextToken: {
          type: 'string',
          description: 'Pagination token for next page of results',
        },
      },
    },
    handler: async (params: unknown) => {
      const input = getInventorySummarySchema.parse(params);
      const client = getSPAPIClient();
      const config = getConfig();

      const queryParams: Record<string, unknown> = {
        granularityType: 'Marketplace',
        granularityId: config.MARKETPLACE_ID,
        marketplaceIds: config.MARKETPLACE_ID,
        details: true,
      };

      if (input.sellerSkus && input.sellerSkus.length > 0) {
        queryParams.sellerSkus = input.sellerSkus.slice(0, 50).join(',');
      }

      if (input.nextToken) {
        queryParams.nextToken = input.nextToken;
      }

      const response = await client.get<GetInventorySummariesResponse>(
        '/fba/inventory/v1/summaries',
        queryParams,
        { rateLimitCategory: 'inventory' }
      );

      const summaries = response.payload.inventorySummaries || [];

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                totalSkus: summaries.length,
                hasMore: !!response.pagination?.nextToken,
                nextToken: response.pagination?.nextToken,
                inventory: summaries.map((item) => ({
                  asin: item.asin,
                  fnSku: item.fnSku,
                  sellerSku: item.sellerSku,
                  productName: item.productName,
                  condition: item.condition,
                  totalQuantity: item.totalQuantity,
                  fulfillableQuantity: item.inventoryDetails?.fulfillableQuantity || 0,
                  inboundWorking: item.inventoryDetails?.inboundWorkingQuantity || 0,
                  inboundShipped: item.inventoryDetails?.inboundShippedQuantity || 0,
                  inboundReceiving: item.inventoryDetails?.inboundReceivingQuantity || 0,
                  reserved: item.inventoryDetails?.reservedQuantity?.totalReservedQuantity || 0,
                  unfulfillable:
                    item.inventoryDetails?.unfulfillableQuantity?.totalUnfulfillableQuantity || 0,
                  lastUpdated: item.lastUpdatedTime,
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
    name: 'get_fba_inventory_details',
    description:
      'Get detailed FBA inventory information including breakdown of reserved quantities, unfulfillable reasons, and researching quantities. Provides deeper insight into inventory status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sellerSku: {
          type: 'string',
          description: 'Filter by specific seller SKU',
        },
        asin: {
          type: 'string',
          description: 'Filter by specific ASIN',
        },
      },
    },
    handler: async (params: unknown) => {
      const input = getFbaInventorySchema.parse(params);
      const client = getSPAPIClient();
      const config = getConfig();

      const queryParams: Record<string, unknown> = {
        granularityType: 'Marketplace',
        granularityId: config.MARKETPLACE_ID,
        marketplaceIds: config.MARKETPLACE_ID,
        details: true,
      };

      if (input.sellerSku) {
        queryParams.sellerSkus = input.sellerSku;
      }

      const response = await client.get<GetInventorySummariesResponse>(
        '/fba/inventory/v1/summaries',
        queryParams,
        { rateLimitCategory: 'inventory' }
      );

      const summaries = response.payload.inventorySummaries || [];

      // Filter by ASIN if provided
      const filtered = input.asin
        ? summaries.filter((item) => item.asin === input.asin)
        : summaries;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                totalItems: filtered.length,
                inventoryDetails: filtered.map((item) => ({
                  asin: item.asin,
                  fnSku: item.fnSku,
                  sellerSku: item.sellerSku,
                  productName: item.productName,
                  condition: item.condition,
                  totalQuantity: item.totalQuantity,
                  lastUpdated: item.lastUpdatedTime,
                  details: {
                    fulfillable: item.inventoryDetails?.fulfillableQuantity || 0,
                    inbound: {
                      working: item.inventoryDetails?.inboundWorkingQuantity || 0,
                      shipped: item.inventoryDetails?.inboundShippedQuantity || 0,
                      receiving: item.inventoryDetails?.inboundReceivingQuantity || 0,
                    },
                    reserved: {
                      total: item.inventoryDetails?.reservedQuantity?.totalReservedQuantity || 0,
                      pendingCustomerOrder:
                        item.inventoryDetails?.reservedQuantity?.pendingCustomerOrderQuantity || 0,
                      pendingTransshipment:
                        item.inventoryDetails?.reservedQuantity?.pendingTransshipmentQuantity || 0,
                      fcProcessing:
                        item.inventoryDetails?.reservedQuantity?.fcProcessingQuantity || 0,
                    },
                    unfulfillable: {
                      total:
                        item.inventoryDetails?.unfulfillableQuantity?.totalUnfulfillableQuantity ||
                        0,
                      customerDamaged:
                        item.inventoryDetails?.unfulfillableQuantity?.customerDamagedQuantity || 0,
                      warehouseDamaged:
                        item.inventoryDetails?.unfulfillableQuantity?.warehouseDamagedQuantity || 0,
                      distributorDamaged:
                        item.inventoryDetails?.unfulfillableQuantity?.distributorDamagedQuantity ||
                        0,
                      carrierDamaged:
                        item.inventoryDetails?.unfulfillableQuantity?.carrierDamagedQuantity || 0,
                      defective:
                        item.inventoryDetails?.unfulfillableQuantity?.defectiveQuantity || 0,
                      expired: item.inventoryDetails?.unfulfillableQuantity?.expiredQuantity || 0,
                    },
                    researching: {
                      total:
                        item.inventoryDetails?.researchingQuantity?.totalResearchingQuantity || 0,
                      breakdown:
                        item.inventoryDetails?.researchingQuantity?.researchingQuantityBreakdown ||
                        [],
                    },
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
