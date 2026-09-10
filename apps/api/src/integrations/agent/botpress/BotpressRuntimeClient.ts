import {
  Client,
  ForbiddenError,
  OperationTimeoutError,
  UnauthorizedError,
  isApiError,
} from '@botpress/client';

export type BotpressRuntimeErrorKind =
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'INVALID_PROVIDER_RESPONSE';

type RuntimeOperation =
  | 'listConversations'
  | 'getBot'
  | 'createUser'
  | 'createConversation'
  | 'createMessage'
  | 'listMessages';

export class BotpressRuntimeError extends Error {
  constructor(
    readonly kind: BotpressRuntimeErrorKind,
    readonly operation: RuntimeOperation,
    readonly status?: number,
    readonly providerType?: string,
    readonly providerMessage?: string,
  ) {
    super(`Botpress Runtime ${operation} failed${status === undefined ? '' : ` with HTTP ${status}`}.`);
  }
}

export interface BotpressRuntimeApi {
  listConversations(input: {
    sortField: 'updatedAt'; sortDirection: 'desc'; pageSize: number; integrationName?: string;
  }): Promise<{ conversations: Array<{ integration: string; channel: string }> }>;
  getBot(input: { id: string }): Promise<{ bot: { integrations: Record<string, {
    id: string; name: string; enabled: boolean; status: string;
  }> } }>;
  createUser(input: {
    tags: Record<string, string>; name: string;
  }): Promise<{ user: { id: string } }>;
  createConversation(input: {
    channel: string; tags: Record<string, string>;
  }): Promise<{ conversation: { id: string } }>;
  createMessage(input: {
    payload: { text: string }; userId: string; conversationId: string; type: 'text'; tags: Record<string, string>;
  }): Promise<{ message: { id: string; createdAt: string } }>;
  listMessages(input: {
    conversationId: string; afterDate: string;
  }): Promise<{ messages: Array<{
    id: string; createdAt: string; conversationId: string;
    direction: 'incoming' | 'outgoing'; type: string; payload: unknown;
  }> }>;
}

export interface BotpressRuntimeClientOptions {
  token: string;
  botId: string;
  integrationName?: string;
  requestTimeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  responseSettleMs?: number;
  incompleteResponseSettleMs?: number;
  clientFactory?: (integrationId?: string) => BotpressRuntimeApi;
}

interface RuntimeContext {
  integrationId: string;
  channel: string;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function textPayload(value: unknown): value is { text: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'text' in value && nonempty(value.text);
}

function integrationError(error: unknown, operation: RuntimeOperation): BotpressRuntimeError {
  if (error instanceof UnauthorizedError) {
    return new BotpressRuntimeError('AUTHENTICATION_ERROR', operation, error.code, error.type, error.message);
  }
  if (error instanceof ForbiddenError) {
    return new BotpressRuntimeError('AUTHORIZATION_ERROR', operation, error.code, error.type, error.message);
  }
  if (error instanceof OperationTimeoutError
    || (error instanceof DOMException && error.name === 'TimeoutError')) {
    return new BotpressRuntimeError('TIMEOUT', operation, isApiError(error) ? error.code : undefined,
      isApiError(error) ? error.type : undefined, error.message);
  }
  if (isApiError(error)) {
    return new BotpressRuntimeError('UNAVAILABLE', operation, error.code, error.type, error.message);
  }
  return new BotpressRuntimeError('UNAVAILABLE', operation);
}

export class BotpressRuntimeClient {
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly responseSettleMs: number;
  private readonly incompleteResponseSettleMs: number;
  private readonly clientFactory: (integrationId?: string) => BotpressRuntimeApi;
  private readonly botRuntime: BotpressRuntimeApi;
  private context: Promise<RuntimeContext> | undefined;

  constructor(private readonly options: BotpressRuntimeClientOptions) {
    this.pollTimeoutMs = options.pollTimeoutMs ?? 45_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.responseSettleMs = options.responseSettleMs ?? 1_500;
    this.incompleteResponseSettleMs = options.incompleteResponseSettleMs ?? 15_000;
    this.clientFactory = options.clientFactory ?? ((integrationId) => new Client({
      token: options.token, botId: options.botId, timeout: options.requestTimeoutMs ?? 10_000,
      ...(integrationId && { integrationId }),
    }));
    this.botRuntime = this.clientFactory();
  }

  async ask(text: string, responseComplete?: (texts: string[]) => boolean): Promise<string[]> {
    const context = await this.runtimeContext();
    const runtime = this.clientFactory(context.integrationId);
    const user = await this.call('createUser', () => runtime.createUser({
      tags: {},
      name: 'NEXA Backend',
    }));
    if (!nonempty(user.user.id)) {
      throw new BotpressRuntimeError('INVALID_PROVIDER_RESPONSE', 'createUser');
    }
    const createdConversation = await this.call('createConversation', () => runtime.createConversation({
      channel: context.channel,
      tags: {},
    }));
    if (!nonempty(createdConversation.conversation.id)) {
      throw new BotpressRuntimeError('INVALID_PROVIDER_RESPONSE', 'createConversation');
    }
    const createdMessage = await this.call('createMessage', () => runtime.createMessage({
      payload: { text },
      userId: user.user.id,
      conversationId: createdConversation.conversation.id,
      type: 'text',
      tags: {},
    }));
    if (!nonempty(createdMessage.message.id) || !nonempty(createdMessage.message.createdAt)) {
      throw new BotpressRuntimeError('INVALID_PROVIDER_RESPONSE', 'createMessage');
    }
    return this.pollForOutgoing(
      runtime,
      createdConversation.conversation.id,
      createdMessage.message.createdAt,
      responseComplete,
    );
  }

  private runtimeContext(): Promise<RuntimeContext> {
    this.context ??= this.discoverContext().catch((error: unknown) => {
      this.context = undefined;
      throw error;
    });
    return this.context;
  }

  private async discoverContext(): Promise<RuntimeContext> {
    const result = await this.call('listConversations', () => this.botRuntime.listConversations({
      sortField: 'updatedAt',
      sortDirection: 'desc',
      pageSize: 50,
      ...(this.options.integrationName && { integrationName: this.options.integrationName }),
    }));
    const match = result.conversations.find((item) => nonempty(item.integration) && nonempty(item.channel)
      && (!this.options.integrationName || item.integration === this.options.integrationName));
    if (!match) throw new BotpressRuntimeError('INVALID_PROVIDER_RESPONSE', 'listConversations');
    const bot = await this.call('getBot', () => this.botRuntime.getBot({ id: this.options.botId }));
    const installed = Object.values(bot.bot.integrations)
      .find((item) => item.enabled && item.status === 'registered' && item.name === match.integration);
    if (!installed || !nonempty(installed.id)) {
      throw new BotpressRuntimeError('INVALID_PROVIDER_RESPONSE', 'getBot');
    }
    return { integrationId: installed.id, channel: match.channel };
  }

  private async pollForOutgoing(
    runtime: BotpressRuntimeApi,
    conversationId: string,
    afterDate: string,
    responseComplete?: (texts: string[]) => boolean,
  ): Promise<string[]> {
    const deadline = Date.now() + this.pollTimeoutMs;
    const texts = new Map<string, string>();
    let lastMessageAt: number | undefined;
    do {
      const result = await this.call('listMessages', () => runtime.listMessages({ conversationId, afterDate }));
      for (const item of result.messages) {
        if (item.conversationId !== conversationId || item.direction !== 'outgoing'
          || item.type !== 'text' || !textPayload(item.payload) || texts.has(item.id)) continue;
        texts.set(item.id, item.payload.text.trim());
        lastMessageAt = Date.now();
      }
      if (responseComplete?.([...texts.values()])) return [...texts.values()];
      if (!responseComplete && lastMessageAt !== undefined && Date.now() - lastMessageAt >= this.responseSettleMs) {
        return [...texts.values()];
      }
      if (responseComplete && lastMessageAt !== undefined
        && Date.now() - lastMessageAt >= this.incompleteResponseSettleMs) {
        return [...texts.values()];
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(this.pollIntervalMs, remaining)));
    } while (Date.now() < deadline);
    if (texts.size) return [...texts.values()];
    throw new BotpressRuntimeError('TIMEOUT', 'listMessages');
  }

  private async call<T>(operation: RuntimeOperation, request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof BotpressRuntimeError) throw error;
      throw integrationError(error, operation);
    }
  }
}
