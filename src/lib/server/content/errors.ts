export type ContentErrorCode = 'NOT_FOUND' | 'INVALID' | 'IN_USE' | 'IMPORT_FAILED';

/** Expected content failures; admin remote functions and MCP tools turn these into messages. */
export class ContentError extends Error {
	constructor(
		readonly code: ContentErrorCode,
		message: string = code
	) {
		super(message);
		this.name = 'ContentError';
	}
}
