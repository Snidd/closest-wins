import type { RequestHandler } from './$types';
import { handleMcpRequest, isAuthorized } from '#lib/server/mcp/index.ts';

/** Streamable HTTP MCP endpoint (bearer MCP_TOKEN). Implemented in Wave 2. */
const handler: RequestHandler = async ({ request }) => {
	if (!isAuthorized(request)) {
		return new Response('Unauthorized', {
			status: 401,
			headers: { 'www-authenticate': 'Bearer realm="mcp"' }
		});
	}
	return handleMcpRequest(request);
};

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
