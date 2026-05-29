import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface TraceContext {
  traceId: string;
  conversationKey?: string | undefined;
  userId?: string | undefined;
  guildId?: string | undefined;
  channelId?: string | undefined;
  threadId?: string | undefined;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function runWithTrace<T>(context: Partial<TraceContext>, callback: () => T): T {
  const existing = traceStorage.getStore();
  return traceStorage.run(
    {
      traceId: context.traceId ?? existing?.traceId ?? randomUUID(),
      ...(existing ?? {}),
      ...withoutUndefined(context),
    },
    callback,
  );
}

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function createTraceId(): string {
  return randomUUID();
}

function withoutUndefined(context: Partial<TraceContext>): Partial<TraceContext> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as Partial<TraceContext>;
}
