/**
 * MCP server over Streamable HTTP at `/mcp` (route: src/routes/mcp/+server.ts), bearer
 * `MCP_TOKEN`. Tools wrap `#lib/server/content/` only (no game control); see `tools.ts`.
 *
 * Transport: the SDK's web-standard `WebStandardStreamableHTTPServerTransport` (takes a
 * `Request`, returns a `Response`), in STATELESS mode with JSON responses: every POST gets a
 * fresh `McpServer` + transport, no session id, and the reply is a single `application/json`
 * body (tools are plain request/response; nothing is streamed). There is no server-initiated
 * stream (GET → 405) and no session to terminate (DELETE → 405), as the spec allows.
 *
 * Request pipeline (`mcpEndpoint`): Origin check (403) → bearer auth (401) → method → SDK.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { MCP_TOKEN, ORIGIN } from '$app/env/private';
import { constantTimeEqual } from '../auth/crypto.ts';
import { INSTRUCTIONS, SERVER_INFO } from './instructions.ts';
import { registerTools } from './tools.ts';
import type { ViewContext } from './views.ts';

/** Checks `Authorization: Bearer <MCP_TOKEN>` in constant time. */
export function isAuthorized(request: Request): boolean {
	const header = request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return !!match && constantTimeEqual(match[1]!.trim(), MCP_TOKEN);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * DNS-rebinding / cross-site guard (spec: servers MUST validate `Origin`). Requests without an
 * Origin (non-browser MCP clients) are allowed. A browser Origin must be the app's public
 * `ORIGIN`, or the endpoint's own origin when it is served on a loopback host (dev). The
 * request's own origin is not trusted otherwise: under DNS rebinding the Host header (and so
 * `request.url`) is attacker-controlled and would always "match".
 */
export function isAllowedOrigin(request: Request): boolean {
	const origin = request.headers.get('origin');
	if (origin === null) return true;
	if (origin === ORIGIN) return true;
	const self = new URL(request.url);
	return LOOPBACK_HOSTS.has(self.hostname) && origin === self.origin;
}

const jsonRpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
	Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status, headers });

/** The full HTTP pipeline for `/mcp` (all methods). */
export async function mcpEndpoint(request: Request): Promise<Response> {
	if (!isAllowedOrigin(request)) {
		return jsonRpcError(403, -32000, 'Forbidden: Origin not allowed');
	}
	if (!isAuthorized(request)) {
		const sentToken = !!request.headers.get('authorization')?.trim();
		return jsonRpcError(401, -32001, 'Unauthorized: send "Authorization: Bearer <MCP_TOKEN>"', {
			'www-authenticate': sentToken
				? 'Bearer realm="closest-wins-mcp", error="invalid_token"'
				: 'Bearer realm="closest-wins-mcp"'
		});
	}
	return handleMcpRequest(request);
}

/** A fresh server with every tool registered (one per request: stateless). */
export function createMcpServer(ctx: ViewContext): McpServer {
	const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
	registerTools(server, ctx);
	return server;
}

/** Handles one MCP HTTP request (POST/GET/DELETE). Caller has already checked `isAuthorized`. */
export async function handleMcpRequest(request: Request): Promise<Response> {
	if (request.method !== 'POST') {
		// Stateless JSON mode: no server-initiated SSE stream (GET) and no session to end (DELETE).
		return jsonRpcError(405, -32000, 'Method not allowed: this server only accepts POST', { allow: 'POST' });
	}
	const server = createMcpServer({ origin: new URL(request.url).origin });
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	try {
		// In JSON mode this resolves once every response is ready, so closing afterwards is safe.
		return await transport.handleRequest(request);
	} catch (e) {
		console.error('[mcp] request failed', e);
		return jsonRpcError(500, -32603, 'Internal error');
	} finally {
		await server.close().catch(() => {});
	}
}
