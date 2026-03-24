import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { orderTools } from './orders.js';
import { inventoryTools } from './inventory.js';
import { salesTools } from './sales.js';
import { allReportTools } from './reports/index.js';
import { catalogTools } from './catalog.js';
import { financeTools } from './finances.js';

// Combine all tools
const allTools = [...orderTools, ...inventoryTools, ...salesTools, ...allReportTools, ...catalogTools, ...financeTools];

// Tool type for internal use
interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (params: unknown) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
  }>;
}

export function registerAllTools(server: Server): void {
  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((tool: Tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = allTools.find((t: Tool) => t.name === name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await tool.handler(args);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });
}

// Export individual tool arrays for testing
export { orderTools, inventoryTools, salesTools, allReportTools, catalogTools, financeTools };
