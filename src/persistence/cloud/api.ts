import { NEON_CONN, NEON_SQL_URL } from './config';

interface SqlResponse {
  rows?: Record<string, unknown>[];
  message?: string;
}

/** Run a single SQL statement against the Neon Data API. */
export async function cloudSql(query: string): Promise<Record<string, unknown>[]> {
  let res: Response;
  let body: SqlResponse = {};
  try {
    res = await fetch(NEON_SQL_URL, {
      method: 'POST',
      headers: {
        'neon-connection-string': NEON_CONN,
        'content-type': 'application/json',
      },
      // Neon's Data API rejects bodies without a params array ("query is
      // not supported"), so always send one even when empty.
      body: JSON.stringify({ query, params: [] }),
    });
    body = (await res.json()) as SqlResponse;
  } catch {
    throw new Error('Could not reach the cloud database — check your connection.');
  }
  if (!res.ok || typeof body.message === 'string') {
    throw new Error(body.message ?? `Cloud database error (${res.status})`);
  }
  return body.rows ?? [];
}

/** SQL literal for a string value (single quotes doubled). */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
