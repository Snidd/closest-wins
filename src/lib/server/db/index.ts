import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';
import { DATABASE_URL } from '$app/env/private';

/** The one postgres.js connection pool for the app process. */
export const client = postgres(DATABASE_URL, { max: 10 });

export const db = drizzle(client, { schema });

export type Database = typeof db;
/** A transaction handle, as passed to `db.transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Either the db or a transaction; accept this in helpers that can run inside a transaction. */
export type Executor = Database | Transaction;

export { schema };
