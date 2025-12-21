/* for sqlite */
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { env } from '../env';
import * as schema from "./schemas";

const client = createClient({ url: env.DATABASE_URL ?? 'file:./lavamusic.db' });
export const db = drizzle({ client, schema });

export { schema };

/* for postgres */
/* import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env';
import * as schema from "./postgres.schemas"; // rename file to postgres.schemas to schemas

const pool = new Pool({
    connectionString: env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

export { schema }; */