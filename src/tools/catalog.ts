import { z } from 'zod';
import { getSPAPIClient } from '../client/sp-api-client.js';
import { getConfig } from '../config/index.js';
import type { GetCatalogItemResponse, SearchCatalogItemsResponse } from '../types/sp-api.js';

// Input schemas
const getCatalogItemSchema = z.object({
  asin: z.string().describe('The ASIN of the product to retrieve'),
  includedData: z
    .string()
    .optional()
    .default('summaries,attributes,salesRanks,images')
    .describe('Comma-separated data to include: summaries, attributes, salesRanks, images, dimensions, identifiers, relationships, productTypes'),
});

const searchCatalogSchema = z.object({
  keywords: z.string().optional().describe('Keywords to search for in the catalog'),
  identifiers: z.string().optional().describe('Comma-separated identifiers to search (ASINs, SKUs, UPCs, EANs)'),
  identifiersType: z
    .enum(['ASIN', 'SKU', 'UPC', 'EAN'])
    .optional()
    .describe('The type of identifiers provided'),
  includedData: z
    .string()
    .optional()
    .default('summaries')
    .describe('Comma-separated data to include: summaries, attributes, salesRanks, images, dimensions, identifiers, relationships, productTypes'),
  pageSize: z.number().optional().default(10).describe('Number of results per page (max 20)'),
  pageToken: z.string().optional().describe('Pagination token for next page'),
});

// Tool definitions
export const catalogTools = [
  {
    name: 'get_catalog_item',
    description:
      'Get detailed product information from the Amazon catalog by ASIN. Returns product title, brand, category, BSR (Best Sellers Rank), images, bullet points, and attributes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        asin: {
          type: 'string',
          description: 'The ASIN of the product to retrieve',
        },
        includedData: {
          type: 'string',
          description:
            'Comma-separated data to include: summaries, attributes, salesRanks, images, dimensions, identifiers, relationships, productTypes',
          default: 'summaries,attributes,salesRanks,images',
        },
      },
      required: ['asin'],
    },
    handler: async (params: unknown) => {
      const input = getCatalogItemSchema.parse(params);
      const client = getSPAPIClient();
      const config = getConfig();

      const queryParams: Record<string, unknown> = {
        marketplaceIds: config.MARKETPLACE_ID,
        includedData: input.includedData,
      };

      const response = await client.get<GetCatalogItemResponse>(
        `/catalog/2022-04-01/items/${input.asin}`,
        queryParams,
        { rateLimitCategory: 'catalog' }
      );

      const item = response;

      // Extract summary for the Canadian marketplace
      const summary = item.summaries?.find(
        (s) => s.marketplaceId === config.MARKETPLACE_ID
      ) || item.summaries?.[0];

      // Extract sales ranks
      const salesRanks = item.salesRanks?.flatMap((rankGroup) =>
        rankGroup.displayGroupRanks?.map((rank) => ({
          title: rank.title,
          rank: rank.rank,
          link: rank.link,
        })) || []
      ) || [];

      // Extract images
      const images = item.images?.flatMap((imageGroup) =>
        imageGroup.images?.map((img) => ({
          variant: img.variant,
          link: img.link,
          width: img.width,
          height: img.height,
        })) || []
      ) || [];

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                asin: item.asin,
                title: summary?.itemName,
                brand: summary?.brand,
                manufacturer: summary?.manufacturer,
                classification: summary?.classificationType
                  ? {
                      type: summary.classificationType,
                      displayName: summary.classificationDisplayName,
                    }
                  : undefined,
                color: summary?.color,
                size: summary?.size,
                modelNumber: summary?.modelNumber,
                packageQuantity: summary?.packageQuantity,
                bulletPoints: summary?.bulletPoints,
                salesRanks,
                imageCount: images.length,
                images: images.slice(0, 10), // Limit to first 10 images
                attributes: item.attributes,
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
    name: 'search_catalog',
    description:
      'Search the Amazon catalog by keywords or identifiers (ASIN, SKU, UPC, EAN). Returns a list of matching items with summaries. Useful for finding products or looking up items by identifier.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'string',
          description: 'Keywords to search for in the catalog',
        },
        identifiers: {
          type: 'string',
          description: 'Comma-separated identifiers to search (ASINs, SKUs, UPCs, EANs)',
        },
        identifiersType: {
          type: 'string',
          enum: ['ASIN', 'SKU', 'UPC', 'EAN'],
          description: 'The type of identifiers provided',
        },
        includedData: {
          type: 'string',
          description:
            'Comma-separated data to include: summaries, attributes, salesRanks, images, dimensions, identifiers, relationships, productTypes',
          default: 'summaries',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results per page (max 20)',
          default: 10,
        },
        pageToken: {
          type: 'string',
          description: 'Pagination token for next page',
        },
      },
    },
    handler: async (params: unknown) => {
      const input = searchCatalogSchema.parse(params);
      const client = getSPAPIClient();
      const config = getConfig();

      if (!input.keywords && !input.identifiers) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { error: 'Either keywords or identifiers must be provided' },
                null,
                2
              ),
            },
          ],
        };
      }

      const queryParams: Record<string, unknown> = {
        marketplaceIds: config.MARKETPLACE_ID,
        includedData: input.includedData,
        pageSize: Math.min(input.pageSize || 10, 20),
      };

      if (input.keywords) queryParams.keywords = input.keywords;
      if (input.identifiers) queryParams.identifiers = input.identifiers;
      if (input.identifiersType) queryParams.identifiersType = input.identifiersType;
      if (input.pageToken) queryParams.pageToken = input.pageToken;

      const response = await client.get<SearchCatalogItemsResponse>(
        '/catalog/2022-04-01/items',
        queryParams,
        { rateLimitCategory: 'catalog' }
      );

      const items = response.items || [];

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                totalResults: response.numberOfResults || items.length,
                hasMore: !!response.pagination?.nextToken,
                nextToken: response.pagination?.nextToken,
                items: items.map((item) => {
                  const summary = item.summaries?.find(
                    (s) => s.marketplaceId === config.MARKETPLACE_ID
                  ) || item.summaries?.[0];

                  return {
                    asin: item.asin,
                    title: summary?.itemName,
                    brand: summary?.brand,
                    classification: summary?.classificationType
                      ? {
                          type: summary.classificationType,
                          displayName: summary.classificationDisplayName,
                        }
                      : undefined,
                    color: summary?.color,
                    size: summary?.size,
                  };
                }),
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
