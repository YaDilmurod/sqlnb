import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import { PostgresDriver } from '../drivers/postgres';
import { buildSchemaQuery, parseSchemaRows } from '../engines/schema-engine';

const server = new Server(
  {
    name: 'sqlnb-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define the available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'execute_sql',
        description: 'Execute a SQL query against a PostgreSQL database',
        inputSchema: {
          type: 'object',
          properties: {
            connectionString: {
              type: 'string',
              description: 'PostgreSQL connection string (e.g. postgresql://user:pass@host:port/db)',
            },
            query: {
              type: 'string',
              description: 'The SQL query to execute',
            },
          },
          required: ['connectionString', 'query'],
        },
      },
      {
        name: 'get_schema',
        description: 'Get the database schema including tables and columns',
        inputSchema: {
          type: 'object',
          properties: {
            connectionString: {
              type: 'string',
              description: 'PostgreSQL connection string',
            },
          },
          required: ['connectionString'],
        },
      },
      {
        name: 'read_sqlnb',
        description: 'Read and parse a .sqlnb notebook file',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute path to the .sqlnb file' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'add_sqlnb_cell',
        description: 'Append a new cell to a .sqlnb file',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute path to the .sqlnb file' },
            type: { type: 'string', description: 'Cell type (e.g., sql, markdown, connection)' },
            content: { type: 'string', description: 'The text content of the cell' },
            name: { type: 'string', description: 'Optional name for the cell (used for SQL block names)' },
          },
          required: ['filePath', 'type', 'content'],
        },
      },
      {
        name: 'edit_sqlnb_cell',
        description: 'Edit an existing cell in a .sqlnb file by its index',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute path to the .sqlnb file' },
            index: { type: 'number', description: 'The 0-based index of the cell to edit' },
            type: { type: 'string', description: 'The new cell type' },
            content: { type: 'string', description: 'The new text content of the cell' },
            name: { type: 'string', description: 'Optional name for the cell' },
          },
          required: ['filePath', 'index', 'type', 'content'],
        },
      },
    ],
  };
});

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'execute_sql') {
    const { connectionString, query } = args as any;
    if (!connectionString || !query) {
      throw new Error('connectionString and query are required');
    }

    const driver = new PostgresDriver();
    try {
      await driver.connect(connectionString);
      // Using executeStatement to allow any kind of query.
      // PostgresDriver handles multi-statement queries internally.
      const result = await driver.executeStatement(query);
      
      let rows = result.rows || [];
      const command = result.command || '';
      const rowCount = result.rowCount || rows.length;

      // Hard limit on rows returned to the LLM to avoid token overflow
      const MAX_ROWS = 500;
      const truncated = rows.length > MAX_ROWS;
      if (truncated) {
        rows = rows.slice(0, MAX_ROWS);
      }

      const responsePayload = {
        command,
        rowCount,
        returnedRows: rows.length,
        truncated,
        rows,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(responsePayload, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error executing query: ${error.message}` }],
        isError: true,
      };
    } finally {
      await driver.disconnect();
    }
  }

  if (name === 'get_schema') {
    const { connectionString } = args as any;
    if (!connectionString) {
      throw new Error('connectionString is required');
    }

    const driver = new PostgresDriver();
    try {
      await driver.connect(connectionString);
      const query = buildSchemaQuery();
      const result = await driver.executeStatement(query);
      const schema = parseSchemaRows(result.rows);
      return {
        content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error fetching schema: ${error.message}` }],
        isError: true,
      };
    } finally {
      await driver.disconnect();
    }
  }

  if (name === 'read_sqlnb') {
    const { filePath } = args as any;
    if (!filePath) throw new Error('filePath is required');
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: 'text', text: `Error reading file: ${e.message}` }], isError: true };
    }
  }

  if (name === 'add_sqlnb_cell') {
    const { filePath, type, content, name: cellName } = args as any;
    if (!filePath || !type || content === undefined) throw new Error('filePath, type, and content are required');
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (!parsed.cells || !Array.isArray(parsed.cells)) parsed.cells = [];
      const newCell: any = { type, content };
      if (cellName) newCell.name = cellName;
      parsed.cells.push(newCell);
      await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf-8');
      return { content: [{ type: 'text', text: `Cell added successfully. Total cells: ${parsed.cells.length}` }] };
    } catch (e: any) {
      return { content: [{ type: 'text', text: `Error adding cell: ${e.message}` }], isError: true };
    }
  }

  if (name === 'edit_sqlnb_cell') {
    const { filePath, index, type, content, name: cellName } = args as any;
    if (!filePath || index === undefined || !type || content === undefined) throw new Error('filePath, index, type, and content are required');
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (!parsed.cells || !Array.isArray(parsed.cells)) throw new Error('Invalid notebook format');
      if (index < 0 || index >= parsed.cells.length) throw new Error(`Cell index ${index} out of bounds`);
      
      const newCell: any = { type, content };
      if (cellName) newCell.name = cellName;
      parsed.cells[index] = newCell;
      await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf-8');
      return { content: [{ type: 'text', text: `Cell ${index} updated successfully.` }] };
    } catch (e: any) {
      return { content: [{ type: 'text', text: `Error editing cell: ${e.message}` }], isError: true };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SQLNB MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal MCP server error:', error);
  process.exit(1);
});
