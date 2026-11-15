import type { RequestHandler } from './$types';
import { mcpEndpoint } from '#lib/server/mcp/index.ts';

/**
 * Streamable HTTP MCP endpoint (stateless, JSON responses). Origin check, bearer `MCP_TOKEN`
 * auth and method handling live in `mcpEndpoint`; see docs/mcp.md.
 */
const handler: RequestHandler = ({ request }) => mcpEndpoint(request);

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
