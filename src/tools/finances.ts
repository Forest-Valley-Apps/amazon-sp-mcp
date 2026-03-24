import { z } from 'zod';
import { getSPAPIClient } from '../client/sp-api-client.js';
import type {
  GetFinancialEventsResponse,
  GetFinancialEventGroupsResponse,
} from '../types/sp-api.js';

// Input schemas
const getFinancialEventsSchema = z.object({
  postedAfter: z.string().describe('ISO 8601 date. Financial events posted after this date (e.g., 2025-01-01T00:00:00Z)'),
  postedBefore: z.string().optional().describe('ISO 8601 date. Financial events posted before this date'),
  maxResults: z.number().optional().default(100).describe('Maximum number of results per page (max 100)'),
  nextToken: z.string().optional().describe('Pagination token for next page of results'),
});

const getFinancialEventGroupsSchema = z.object({
  financialEventGroupStartedAfter: z
    .string()
    .describe('ISO 8601 date. Event groups that started after this date'),
  financialEventGroupStartedBefore: z
    .string()
    .optional()
    .describe('ISO 8601 date. Event groups that started before this date'),
  maxResults: z.number().optional().default(10).describe('Maximum number of results per page (max 100)'),
  nextToken: z.string().optional().describe('Pagination token for next page of results'),
});

const getOrderFinancialEventsSchema = z.object({
  orderId: z.string().describe('The Amazon order ID (e.g., 111-1234567-1234567)'),
  maxResults: z.number().optional().default(100).describe('Maximum number of results per page (max 100)'),
  nextToken: z.string().optional().describe('Pagination token for next page of results'),
});

// Helper to summarize financial events by type
function summarizeFinancialEvents(events: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(events)) {
    if (Array.isArray(value) && value.length > 0) {
      summary[key] = {
        count: value.length,
        events: value,
      };
    }
  }

  return summary;
}

// Tool definitions
export const financeTools = [
  {
    name: 'get_financial_events',
    description:
      'Get financial events for a date range from Amazon Seller Central. Returns all financial events including sales, refunds, fees, reimbursements, and adjustments. Events are grouped by type for easy analysis.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        postedAfter: {
          type: 'string',
          description: 'ISO 8601 date. Financial events posted after this date (e.g., 2025-01-01T00:00:00Z)',
        },
        postedBefore: {
          type: 'string',
          description: 'ISO 8601 date. Financial events posted before this date',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results per page (max 100)',
          default: 100,
        },
        nextToken: {
          type: 'string',
          description: 'Pagination token for next page of results',
        },
      },
      required: ['postedAfter'],
    },
    handler: async (params: unknown) => {
      const input = getFinancialEventsSchema.parse(params);
      const client = getSPAPIClient();

      const queryParams: Record<string, unknown> = {
        PostedAfter: input.postedAfter,
        MaxResultsPerPage: Math.min(input.maxResults || 100, 100),
      };

      if (input.postedBefore) queryParams.PostedBefore = input.postedBefore;
      if (input.nextToken) queryParams.NextToken = input.nextToken;

      const response = await client.get<GetFinancialEventsResponse>(
        '/finances/v0/financialEvents',
        queryParams,
        { rateLimitCategory: 'finances' }
      );

      const events = response.payload?.FinancialEvents || {};
      const summary = summarizeFinancialEvents(events);

      // Count total events across all types
      const totalEvents = Object.values(summary).reduce(
        (total: number, group) => total + ((group as { count: number }).count || 0),
        0
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                totalEventCount: totalEvents,
                hasMore: !!response.payload?.NextToken,
                nextToken: response.payload?.NextToken,
                eventTypes: Object.keys(summary),
                financialEvents: summary,
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
    name: 'get_financial_event_groups',
    description:
      'Get financial event groups (payment disbursements) from Amazon Seller Central. Shows grouped financial events including fund transfers, account balances, and settlement periods. Useful for tracking payments and reconciliation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        financialEventGroupStartedAfter: {
          type: 'string',
          description: 'ISO 8601 date. Event groups that started after this date',
        },
        financialEventGroupStartedBefore: {
          type: 'string',
          description: 'ISO 8601 date. Event groups that started before this date',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results per page (max 100)',
          default: 10,
        },
        nextToken: {
          type: 'string',
          description: 'Pagination token for next page of results',
        },
      },
      required: ['financialEventGroupStartedAfter'],
    },
    handler: async (params: unknown) => {
      const input = getFinancialEventGroupsSchema.parse(params);
      const client = getSPAPIClient();

      const queryParams: Record<string, unknown> = {
        FinancialEventGroupStartedAfter: input.financialEventGroupStartedAfter,
        MaxResultsPerPage: Math.min(input.maxResults || 10, 100),
      };

      if (input.financialEventGroupStartedBefore) {
        queryParams.FinancialEventGroupStartedBefore = input.financialEventGroupStartedBefore;
      }
      if (input.nextToken) queryParams.NextToken = input.nextToken;

      const response = await client.get<GetFinancialEventGroupsResponse>(
        '/finances/v0/financialEventGroups',
        queryParams,
        { rateLimitCategory: 'finances' }
      );

      const groups = response.payload?.FinancialEventGroupList || [];

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                totalGroups: groups.length,
                hasMore: !!response.payload?.NextToken,
                nextToken: response.payload?.NextToken,
                eventGroups: groups.map((group) => ({
                  financialEventGroupId: group.FinancialEventGroupId,
                  processingStatus: group.ProcessingStatus,
                  fundTransferStatus: group.FundTransferStatus,
                  originalTotal: group.OriginalTotal,
                  convertedTotal: group.ConvertedTotal,
                  fundTransferDate: group.FundTransferDate,
                  traceId: group.TraceId,
                  accountTail: group.AccountTail,
                  beginningBalance: group.BeginningBalance,
                  financialEventGroupStart: group.FinancialEventGroupStart,
                  financialEventGroupEnd: group.FinancialEventGroupEnd,
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
    name: 'get_order_financial_events',
    description:
      'Get all financial events for a specific Amazon order. Returns detailed financial breakdown including the sale amount, fees, taxes, shipping charges, and any adjustments for that order.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        orderId: {
          type: 'string',
          description: 'The Amazon order ID (e.g., 111-1234567-1234567)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results per page (max 100)',
          default: 100,
        },
        nextToken: {
          type: 'string',
          description: 'Pagination token for next page of results',
        },
      },
      required: ['orderId'],
    },
    handler: async (params: unknown) => {
      const input = getOrderFinancialEventsSchema.parse(params);
      const client = getSPAPIClient();

      const queryParams: Record<string, unknown> = {
        MaxResultsPerPage: Math.min(input.maxResults || 100, 100),
      };

      if (input.nextToken) queryParams.NextToken = input.nextToken;

      const response = await client.get<GetFinancialEventsResponse>(
        `/finances/v0/orders/${input.orderId}/financialEvents`,
        queryParams,
        { rateLimitCategory: 'finances' }
      );

      const events = response.payload?.FinancialEvents || {};
      const summary = summarizeFinancialEvents(events);

      const totalEvents = Object.values(summary).reduce(
        (total: number, group) => total + ((group as { count: number }).count || 0),
        0
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                orderId: input.orderId,
                totalEventCount: totalEvents,
                hasMore: !!response.payload?.NextToken,
                nextToken: response.payload?.NextToken,
                eventTypes: Object.keys(summary),
                financialEvents: summary,
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
