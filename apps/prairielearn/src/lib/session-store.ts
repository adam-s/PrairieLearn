import * as opentelemetry from '@prairielearn/opentelemetry';
import { execute, loadSqlEquiv, queryOptionalRow } from '@prairielearn/postgres';
import { type SessionStore } from '@prairielearn/session';

import { UserSessionSchema } from './db-types.js';

const sql = loadSqlEquiv(import.meta.url);

export class PostgresSessionStore implements SessionStore {
  private setCounter: opentelemetry.Counter;
  private getCounter: opentelemetry.Counter;
  private destroyCounter: opentelemetry.Counter;

  constructor() {
    const meter = opentelemetry.metrics.getMeter('prairielearn');
    this.setCounter = opentelemetry.getCounter(meter, 'session_store.set', {
      valueType: opentelemetry.ValueType.INT,
    });
    this.getCounter = opentelemetry.getCounter(meter, 'session_store.get', {
      valueType: opentelemetry.ValueType.INT,
    });
    this.destroyCounter = opentelemetry.getCounter(meter, 'session_store.destroy', {
      valueType: opentelemetry.ValueType.INT,
    });
  }

  async set(
    key: string,
    data: (Record<string, unknown> & { user_id?: string }) | null,
    expires_at: Date,
  ) {
    this.setCounter.add(1);

    await execute(sql.set_session, {
      key,
      data: JSON.stringify(data),
      expires_at,
      user_id: data?.user_id ?? null,
    });
  }

  async get(key: string) {
    this.getCounter.add(1);

    const session = await queryOptionalRow(sql.get_session, { key }, UserSessionSchema);

    if (!session) {
      return null;
    }

    return {
      data: session.data,
      expiresAt: session.expires_at,
    };
  }

  async destroy(key: string) {
    this.destroyCounter.add(1);

    await execute(sql.destroy_session, { key });
  }
}
