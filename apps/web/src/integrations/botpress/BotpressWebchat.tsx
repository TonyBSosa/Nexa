import { useEffect } from 'react';

const defaultLoaderUrl = 'https://cdn.botpress.cloud/webchat/v5.0/inject.js';
const defaultConfigUrl = 'https://files.bpcontent.cloud/2026/09/07/05/20260907050425-4X01JZLE.js';

const loaderUrl = import.meta.env.VITE_BOTPRESS_WEBCHAT_LOADER_URL || defaultLoaderUrl;
const configUrl = import.meta.env.VITE_BOTPRESS_WEBCHAT_CONFIG_URL || defaultConfigUrl;

type WebchatEvent =
  | 'conversation'
  | 'message'
  | 'error'
  | 'webchat:initialized'
  | 'webchat:ready'
  | 'webchat:opened'
  | 'webchat:closed';

interface BotpressBrowserApi {
  on(type: WebchatEvent, handler: (event: unknown) => void): (() => void) | void;
}

declare global {
  interface Window {
    botpress?: BotpressBrowserApi;
  }
}

const scripts = new Map<string, Promise<void>>();

function loadScriptOnce(url: string, label: string): Promise<void> {
  const existing = scripts.get(url);
  if (existing) return existing;
  const absoluteUrl = new URL(url, document.baseURI).href;
  const loaded = Array.from(document.scripts).find((script) => script.src === absoluteUrl
    && script.dataset.nexaWebchatLoaded === 'true');
  if (loaded) {
    const complete = Promise.resolve();
    scripts.set(url, complete);
    return complete;
  }
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.nexaWebchat = label;
    script.addEventListener('load', () => {
      script.dataset.nexaWebchatLoaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Unable to load ${label}.`)), { once: true });
    document.head.append(script);
  });
  scripts.set(url, pending);
  return pending;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function eventSummary(event: unknown): Record<string, unknown> {
  if (!record(event)) return { valueType: typeof event, ...(scalar(event) && { value: event }) };
  const summary: Record<string, unknown> = { keys: Object.keys(event) };
  for (const key of [
    'conversationId', 'messageId', 'id', 'direction', 'sender', 'authorId', 'userId', 'type',
    'timestamp', 'createdAt', 'updatedAt',
  ]) {
    if (scalar(event[key])) summary[key] = event[key];
  }
  if (typeof event.text === 'string') summary.text = event.text.slice(0, 160);
  if (record(event.payload)) {
    summary.payloadKeys = Object.keys(event.payload);
    if (typeof event.payload.text === 'string') summary.payloadText = event.payload.text.slice(0, 160);
  } else if (event.payload !== undefined) {
    summary.payloadType = typeof event.payload;
  }
  if (record(event.block)) {
    summary.blockKeys = Object.keys(event.block);
    for (const key of ['type', 'text', 'title', 'content']) {
      if (scalar(event.block[key])) summary[`block.${key}`] = event.block[key];
    }
    if (record(event.block.content)) {
      summary.blockContentKeys = Object.keys(event.block.content);
      if (typeof event.block.content.text === 'string') {
        summary.blockContentText = event.block.content.text.slice(0, 160);
      }
    }
  }
  return summary;
}

function observe(api: BotpressBrowserApi): Array<() => void> {
  const unsubscribers: Array<() => void> = [];
  const listen = (type: WebchatEvent, handler: (event: unknown) => void) => {
    const unsubscribe = api.on(type, handler);
    if (typeof unsubscribe === 'function') unsubscribers.push(unsubscribe);
  };
  for (const event of ['conversation', 'message'] as const) {
    listen(event, (payload) => console.debug(`[NEXA Webchat] ${event} ${JSON.stringify(eventSummary(payload))}`));
  }
  for (const event of ['webchat:initialized', 'webchat:ready', 'webchat:opened', 'webchat:closed'] as const) {
    listen(event, () => console.debug(`[NEXA Webchat] ${event}`));
  }
  listen('error', (payload) => console.warn(`[NEXA Webchat] error ${JSON.stringify(eventSummary(payload))}`));
  return unsubscribers;
}

export function BotpressWebchat() {
  useEffect(() => {
    let active = true;
    let unsubscribers: Array<() => void> = [];
    void loadScriptOnce(loaderUrl, 'Botpress loader')
      .then(() => {
        if (!active) return;
        if (!window.botpress) throw new Error('Botpress browser API is unavailable.');
        if (import.meta.env.DEV) unsubscribers = observe(window.botpress);
        return loadScriptOnce(configUrl, 'NEXA Webchat configuration');
      })
      .catch(() => {
        if (active && import.meta.env.DEV) console.warn('[NEXA Webchat] unable to initialize');
      });
    return () => {
      active = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);

  return null;
}
