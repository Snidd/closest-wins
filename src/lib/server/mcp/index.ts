/**
 * MCP server over Streamable HTTP at `/mcp` (route: src/routes/mcp/+server.ts), bearer
 * `MCP_TOKEN`. Tools wrap `#lib/server/content/` only (no game control). `isAuthorized` is
 * implemented (Wave 0); `handleMcpRequest` is a STUB with a final signature.
 *
 * Suggested implementation: `McpServer` from '@modelcontextprotocol/sdk/server/mcp.js' with
 * `WebStandardStreamableHTTPServerTransport` from
 * '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js' (stateless mode).
 */
import { MCP_TOKEN } from '$app/env/private';
import { constantTimeEqual } from '../auth/crypto.ts';

/** Checks `Authorization: Bearer <MCP_TOKEN>` in constant time. */
export function isAuthorized(request: Request): boolean {
	const header = request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return !!match && constantTimeEqual(match[1]!.trim(), MCP_TOKEN);
}

/** Handles one MCP HTTP request (POST/GET/DELETE). Caller has already checked `isAuthorized`. */
export async function handleMcpRequest(request: Request): Promise<Response> {
	return Response.json(
		{ jsonrpc: '2.0', error: { code: -32601, message: 'MCP server not implemented yet' }, id: null },
		{ status: 501 }
	);
}
