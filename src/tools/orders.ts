import { z } from 'zod';
import { getSPAPIClient } from '../client/sp-api-client.js';
import { getConfig } from '../config/index.js';
import type { GetOrdersResponse, GetOrderResponse, GetOrderItemsResponse, Order } from '../types/sp-api.js';

// Input schemas
const getOrdersSchema = z.object({
  createdAfter: z.string().optional().describe('ISO 8601 date. Orders created after this date'),
  createdBefore: z.string().optional().describe('ISO 8601 date. Orders created before this date'),
  lastUpdatedAfter: z.string().optional().describe('ISO 8601 date. Orders updated after this date'),
  lastUpdatedBefore: z.string().optional().describe('ISO 8601 date. Orders updated before this date'),
  orderStatuses: z
    .array(z.string())
    .optional()
    .describe('Filter by order status: Pending, Unshipped, PartiallyShipped, Shipped, Canceled'),
  fulfillmentChannels: z
    .array(z.enum(['AFN', 'MFN']))
    .optional()
    .describe('AFN (Fulfilled by Amazon) or MFN (Merchant Fulfilled)'),
  maxResults: z.number().optional().default(100).describe('Maximum number of orders to return (max 100)'),
});

const amazonOrderIdPattern = /^\d{3}-\d{7}-\d{7}$/;

const getOrderDetailsSchema = z.object({
  orderId: z.string().regex(amazonOrderIdPattern, 'Invalid Amazon order ID format (expected: 111-1234567-1234567)').describe('The Amazon order ID (e.g., 111-1234567-1234567)'),
});

const getOrderItemsSchema = z.object({
  orderId: z.string().regex(amazonOrderIdPattern, 'Invalid Amazon order ID format (expected: 111-1234567-1234567)').describe('The Amazon order ID'),
});

// Tool definitions
export const orderTools = [
  {
    name: 'get_orders',
    description:
      'Retrieve a list of orders from Amazon Seller Central. You can filter by date range, status, and fulfillment channel. Returns order summaries including order ID, status, total, and buyer info.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        createdAfter: {
          type: 'string',
          description: 'ISO 8601 date. Orders created after this date (e.g., 2025-01-01T00:00:00Z)',
        },
        createdBefore: {
          type: 'string',
          description: 'ISO 8601 date. Orders created before this date',
        },
        lastUpdatedAfter: {
          type: 'string',
          description: 'ISO 8601 date. Orders updated after this date',
        },
        lastUpdatedBefore: {
          type: 'string',
          description: 'ISO 8601 date. Orders updated before this date',
        },
        orderStatuses: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter by order status: Pending, Unshipped, PartiallyShipped, Shipped, Canceled',
        },
        fulfillmentChannels: {
          type: 'array',
          items: { type: 'string', enum: ['AFN', 'MFN'] },
          description: 'AFN (Fulfilled by Amazon) or MFN (Merchant Fulfilled)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of orders to return (max 100)',
          default: 100,
        },
      },
    },
    handler: async (params: unknown) => {
      const input = getOrdersSchema.parse(params);
      const client = getSPAPIClient();
      const config = getConfig();

      // Pagination: fetch orders up to maxResults cap
      const maxResults = input.maxResults || 100;
      const allOrders: Order[] = [];
      let nextToken: string | undefined;
      const maxPages = 20; // Safety limit
      let page = 0;

      do {
        const remaining = maxResults - allOrders.length;
        const pageSize = Math.min(remaining, 100);

        const queryParams: Record<string, unknown> = {
          MarketplaceIds: config.MARKETPLACE_ID,
          MaxResultsPerPage: pageSize,
        };

        if (nextToken) queryParams.NextToken = nextToken;
        if (input.createdAfter) queryParams.CreatedAfter = input.createdAfter;
        if (input.createdBefore) queryParams.CreatedBefore = input.createdBefore;
        if (input.lastUpdatedAfter) queryParams.LastUpdatedAfter = input.lastUpdatedAfter;
        if (input.lastUpdatedBefore) queryParams.LastUpdatedBefore = input.lastUpdatedBefore;
        if (input.orderStatuses) queryParams.OrderStatuses = input.orderStatuses.join(',');
        if (input.fulfillmentChannels)
          queryParams.FulfillmentChannels = input.fulfillmentChannels.join(',');

        const response = await client.get<GetOrdersResponse>('/orders/v0/orders', queryParams, {
          rateLimitCategory: 'orders',
        });

        const orders = response.payload.Orders || [];
        allOrders.push(...orders);
        nextToken = response.payload.NextToken;
        page++;
      } while (nextToken && page < maxPages && allOrders.length < maxResults);

      // Trim to exact maxResults in case the last page returned more than needed
      if (allOrders.length > maxResults) {
        allOrders.length = maxResults;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                totalOrders: allOrders.length,
                pagesFetched: page,
                hasMore: !!nextToken,
                orders: allOrders.map((order) => ({
                  orderId: order.AmazonOrderId,
                  status: order.OrderStatus,
                  purchaseDate: order.PurchaseDate,
                  lastUpdateDate: order.LastUpdateDate,
                  fulfillmentChannel: order.FulfillmentChannel,
                  salesChannel: order.SalesChannel,
                  orderTotal: order.OrderTotal,
                  numberOfItemsShipped: order.NumberOfItemsShipped,
                  numberOfItemsUnshipped: order.NumberOfItemsUnshipped,
                  isPrime: order.IsPrime,
                  isBusinessOrder: order.IsBusinessOrder,
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
    name: 'get_order_details',
    description:
      'Get detailed information about a specific Amazon order by order ID. Returns full order details including shipping address, buyer info, and order status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        orderId: {
          type: 'string',
          description: 'The Amazon order ID (e.g., 111-1234567-1234567)',
        },
      },
      required: ['orderId'],
    },
    handler: async (params: unknown) => {
      const input = getOrderDetailsSchema.parse(params);
      const client = getSPAPIClient();

      const response = await client.get<GetOrderResponse>(
        `/orders/v0/orders/${encodeURIComponent(input.orderId)}`,
        undefined,
        { rateLimitCategory: 'orders' }
      );

      const order = response.payload;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                orderId: order.AmazonOrderId,
                sellerOrderId: order.SellerOrderId,
                status: order.OrderStatus,
                purchaseDate: order.PurchaseDate,
                lastUpdateDate: order.LastUpdateDate,
                fulfillmentChannel: order.FulfillmentChannel,
                salesChannel: order.SalesChannel,
                orderTotal: order.OrderTotal,
                paymentMethod: order.PaymentMethod,
                numberOfItemsShipped: order.NumberOfItemsShipped,
                numberOfItemsUnshipped: order.NumberOfItemsUnshipped,
                isPrime: order.IsPrime,
                isBusinessOrder: order.IsBusinessOrder,
                shippingAddress: order.ShippingAddress,
                buyerInfo: order.BuyerInfo,
                earliestShipDate: order.EarliestShipDate,
                latestShipDate: order.LatestShipDate,
                earliestDeliveryDate: order.EarliestDeliveryDate,
                latestDeliveryDate: order.LatestDeliveryDate,
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
    name: 'get_order_items',
    description:
      'Get the line items (products) for a specific Amazon order. Returns details about each item including ASIN, SKU, quantity, price, and tax.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        orderId: {
          type: 'string',
          description: 'The Amazon order ID',
        },
      },
      required: ['orderId'],
    },
    handler: async (params: unknown) => {
      const input = getOrderItemsSchema.parse(params);
      const client = getSPAPIClient();

      const response = await client.get<GetOrderItemsResponse>(
        `/orders/v0/orders/${encodeURIComponent(input.orderId)}/orderItems`,
        undefined,
        { rateLimitCategory: 'orderItems' }
      );

      const items = response.payload.OrderItems || [];

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                orderId: response.payload.AmazonOrderId,
                totalItems: items.length,
                items: items.map((item) => ({
                  orderItemId: item.OrderItemId,
                  asin: item.ASIN,
                  sellerSku: item.SellerSKU,
                  title: item.Title,
                  quantityOrdered: item.QuantityOrdered,
                  quantityShipped: item.QuantityShipped,
                  itemPrice: item.ItemPrice,
                  itemTax: item.ItemTax,
                  shippingPrice: item.ShippingPrice,
                  shippingTax: item.ShippingTax,
                  promotionDiscount: item.PromotionDiscount,
                  isGift: item.IsGift,
                  conditionId: item.ConditionId,
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
