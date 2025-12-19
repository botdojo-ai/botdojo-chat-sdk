import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  BotDojoCanvasProviderProps,
  CanvasEvent,
  BotDojoConnector as BotDojoConnectorType,
  MessageAckEntry,
  CanvasActionOptions,
  UiSize,
} from './types';
import { CanvasContext } from './CanvasContext';
import { BotDojoConnector } from '../connector';

const DEFAULT_ACK_TTL_MS = 3 * 60 * 1000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 20000;

const MCP_FUNCTION_NAME_MAP: Record<string, string> = {
  intent: 'canvas_intent',
  notify: 'canvas_notify',
  prompt: 'canvas_prompt',
  tool: 'canvas_tool',
  callTool: 'canvas_tool',
  link: 'canvas_link',
  update: 'update_canvas_data',
  message: 'mcp_app_message',
  'askAI': 'mcp_app_message',
  'ui-size-change': 'canvas_resize',
  'ui-lifecycle-iframe-ready': 'canvas_ready',
  'botdojo/tool_update': 'botdojo/tool_update',
};

function generateMessageId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeMcpFunctionName(type: string): string {
  if (MCP_FUNCTION_NAME_MAP[type]) {
    return MCP_FUNCTION_NAME_MAP[type];
  }
  return `mcp_app_${type.replace(/-/g, '_')}`;
}

// Exposed for lightweight unit tests
export const __normalizeMcpFunctionName = normalizeMcpFunctionName;
export const __generateMessageId = generateMessageId;

/**
 * Canvas provider for inline canvas cards in chat widgets
 * Supports dojo (legacy) and MCP Apps mode with BotDojo extensions
 * @deprecated Prefer BotDojoAppProvider for new MCP Apps; this stays for legacy/dual-mode canvas flows.
 */
export function BotDojoCanvasProvider({
  children,
  canvasData: initialCanvasData,
  connector: externalConnector,
  modelContext,
  debug = false,
  mode = 'dojo',
  initialRenderData,
  mirrorLegacyCanvasRpc,
}: BotDojoCanvasProviderProps) {
  const isMcpUi = mode === 'mcp-app';
  const mirrorLegacy = mirrorLegacyCanvasRpc ?? isMcpUi;
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [eventHandlers] = useState<Map<string, Set<Function>>>(new Map());
  const [connector, setConnector] = useState<BotDojoConnectorType | null>(externalConnector || null);
  const [canvasData, setCanvasData] = useState<any>(initialCanvasData);
  const [renderData, setRenderData] = useState<any>(initialRenderData ?? null);
  const [uiSize, setUiSize] = useState<UiSize | null>(null);
  const [messageIdMap, setMessageIdMap] = useState<Record<string, MessageAckEntry>>({});
  const [lastAck, setLastAck] = useState<{ messageId: string; status: MessageAckEntry['status']; payload?: any; error?: string; ts: number } | undefined>();
  const [toolPhase, setToolPhase] = useState<'streaming_args' | 'executing' | 'complete' | 'error' | undefined>();
  const [toolStatus, setToolStatus] = useState<'processing' | 'complete' | 'error' | undefined>();
  const [partialArguments, setPartialArguments] = useState<string | undefined>();
  const [parsedArguments, setParsedArguments] = useState<any>();
  const [toolError, setToolError] = useState<string | undefined>();
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const pendingResponses = useRef<Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timer?: number }>>(new Map());
  const cleanupTimers = useRef<Map<string, number>>(new Map());

  const log = useCallback((...args: any[]) => {
    if (debug) {
      console.log('[BotDojoCanvas]', ...args);
    }
  }, [debug]);

  const deriveStatusFromData = useCallback((data?: any): 'processing' | 'complete' | 'error' | undefined => {
    if (!data) return undefined;
    if (data.status === 'complete') return 'complete';
    if (data.status === 'error' || data.error) return 'error';
    if (data.status) return 'processing';
    return undefined;
  }, []);

  const emitEvent = useCallback((event: CanvasEvent, payload: any) => {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (err) {
          console.error('[BotDojoCanvas] Error in event handler:', err);
        }
      });
    }
  }, [eventHandlers]);

  const scheduleAckCleanup = useCallback((messageId: string) => {
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      setMessageIdMap(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      cleanupTimers.current.delete(messageId);
    }, DEFAULT_ACK_TTL_MS);
    cleanupTimers.current.set(messageId, timer);
  }, []);

  const handleMessageAck = useCallback((messageId: string, status: MessageAckEntry['status'], payload?: any, err?: string) => {
    const ts = Date.now();
    setMessageIdMap(prev => ({
      ...prev,
      [messageId]: { status, payload, error: err, ts },
    }));
    setLastAck({ messageId, status, payload, error: err, ts });

    if (status === 'received') {
      emitEvent('mcp-app:message-received', { messageId, payload });
      return;
    }

    const pending = pendingResponses.current.get(messageId);
    if (pending) {
      if (pending.timer) {
        window.clearTimeout(pending.timer);
      }
      pendingResponses.current.delete(messageId);
      if (status === 'error') {
        pending.reject(err ?? new Error('Message responded with error'));
      } else {
        pending.resolve(payload);
      }
    }
    emitEvent('mcp-app:message-response', { messageId, payload, error: err });
    scheduleAckCleanup(messageId);
  }, [emitEvent, scheduleAckCleanup]);

  const handleToolUpdate = useCallback((update: any) => {
    if (!update) return;
    log('Handling botdojo/tool_update', update);

    if (update.stepStatus && update.stepStatus !== 'complete' && update.stepStatus !== 'error') {
      setIsExecuting(true);
    }

    if (update.canvasPatch) {
      setCanvasData((prev: any) => ({
        ...(prev || {}),
        ...(typeof update.canvasPatch === 'object' ? update.canvasPatch : {}),
      }));
    }
    if (update.canvas?.canvasData) {
      setCanvasData((prev: any) => ({
        ...(prev || {}),
        ...update.canvas.canvasData,
      }));
      const derived = deriveStatusFromData(update.canvas.canvasData);
      if (derived) {
        setToolStatus(derived);
      }
    }
    if ('toolPhase' in update) {
      setToolPhase(update.toolPhase);
    }
    if (update.stepStatus) {
      const status = update.stepStatus === 'complete' ? 'complete' : update.stepStatus === 'error' ? 'error' : 'processing';
      setToolStatus(status);
      if (status === 'complete' || status === 'error') {
        setIsExecuting(false);
      }
    }
    if (update.error) {
      setToolError(update.error);
    }
    if (update.argumentStream) {
      setPartialArguments(update.argumentStream);
      try {
        setParsedArguments(JSON.parse(update.argumentStream));
      } catch {
        // ignore parse errors for partial JSON
      }
    }
    if (update.arguments && update.toolPhase === 'executing') {
      try {
        const parsed = typeof update.arguments === 'string' ? JSON.parse(update.arguments) : update.arguments;
        setParsedArguments(parsed);
      } catch (e) {
        log('Error parsing arguments:', e);
      }
    }

    try {
      const customEvent = new CustomEvent('mcp-app:botdojo-tool-update', { detail: update });
      window.dispatchEvent(customEvent);
    } catch {
      // window may not exist in SSR
    }
    emitEvent('mcp-app:botdojo-tool-update', update);
  }, [deriveStatusFromData, emitEvent, log]);

  // Auto-create connector if in iframe (postMessage mode)
  useEffect(() => {
    if (externalConnector) {
      log('Using external connector');
      setConnector(externalConnector);
      return () => undefined;
    }

    if (typeof window === 'undefined' || window.self === window.parent) {
      log('Not in iframe, no auto-connector');
      return () => undefined;
    }

    log('In iframe, creating auto-connector for postMessage');

    // Canvas doesn't need to know its canvasId - that's for the chat client's internal routing
    // Canvas just receives/sends data via postMessage, the parent handles routing
    const apiKey = (window as any).BOTDOJO_API_KEY || 'embedded-canvas';
    let createdConnector: BotDojoConnectorType | null = null;

    try {
      const conn = new BotDojoConnector({
        apiKey,
        accountId: 'embedded',
        projectId: 'embedded',
        flowId: 'embedded',
        modelContext,
        transport: 'postmessage',
        // No canvasId needed - parent routes messages to us based on iframe reference
      });

      createdConnector = conn as unknown as BotDojoConnectorType;

      conn.init().then(() => {
        log('Auto-connector initialized');
        if (window.parent !== window) {
          conn.updatePostMessageTarget(window.parent).then(async () => {
            log('PostMessage bridge to parent configured');
            
            // Retry canvas_ready multiple times since parent may not be ready yet
            // This handles the race condition where iframe loads before parent registers the bridge
            const MAX_READY_RETRIES = 5;
            const RETRY_DELAY_MS = 500;
            
            const sendReadySignal = async (attempt: number): Promise<boolean> => {
              try {
                await (conn as any).connection?.sendRequest('agent_host', 'canvas_ready', [], 2000);
                log(`canvas_ready succeeded on attempt ${attempt}`);
                return true;
              } catch (err: any) {
                if (attempt < MAX_READY_RETRIES) {
                  log(`canvas_ready attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
                  await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                  return sendReadySignal(attempt + 1);
                }
                if (!err?.message?.includes('Timeout')) {
                  console.warn('[BotDojoCanvas] canvas_ready failed after retries (non-critical):', err);
                }
                return false;
              }
            };
            
            try {
              await sendReadySignal(1);
              if (isMcpUi) {
                await (conn as any).connection?.sendRequest('agent_host', normalizeMcpFunctionName('ui-lifecycle-iframe-ready'), [{ ready: true }], 2000).catch(() => undefined);
              }
            } catch (err) {
              console.warn('[BotDojoCanvas] Failed to send ready signal:', err);
            }
          }).catch(err => {
            console.error('[BotDojoCanvas] Failed to configure PostMessage bridge:', err);
            setError(err as Error);
          });
        }
      }).catch(err => {
        console.error('[BotDojoCanvas] Failed to init auto-connector:', err);
        setError(err as Error);
      });

      setConnector(createdConnector);
    } catch (err) {
      console.error('[BotDojoCanvas] Failed to create auto-connector:', err);
      setError(err as Error);
    }

    return () => {
      if (createdConnector && !externalConnector) {
        log('Cleaning up auto-connector');
        createdConnector.close();
      }
    };
  }, [externalConnector, log, modelContext, isMcpUi]);

  useEffect(() => {
    log('Initializing canvas provider', { canvasData, hasConnector: !!connector, mode });
    setIsReady(true);
    emitEvent('canvas:ready', { canvasData, renderData, mode });
  }, [canvasData, connector, emitEvent, log, mode, renderData]);

  const sendCanvasAction = useCallback(async (functionName: string, data: any) => {
    if (!connector) {
      log('Cannot send canvas action - no connector');
      return;
    }
    const conn = connector as any;
    if (!conn.connection?.sendRequest) {
      log('Cannot send canvas action - no RPC connection');
      return;
    }
    try {
      return await conn.connection.sendRequest('agent_host', functionName, [data], 2000);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.toLowerCase().includes('timeout')) {
        log('Canvas action timed out (ignored):', functionName);
        return { ok: true, timeout: true };
      }
      console.warn('[BotDojoCanvas] Canvas action failed:', functionName, err);
      throw err;
    }
  }, [connector, log]);

  const sendMcpUiAction = useCallback(async (type: string, payload: any = {}, options: CanvasActionOptions = {}) => {
    const messageId = options.messageId || payload?.messageId || (options.awaitResponse ? generateMessageId() : undefined);
    const actionPayload = { ...payload, ...(messageId ? { messageId } : {}) };

    if (messageId) {
      setMessageIdMap(prev => ({ ...prev, [messageId]: { status: 'pending', ts: Date.now() } }));
      setLastAck({ messageId, status: 'pending', ts: Date.now() });
    }

    // Map action types to MCP Apps protocol methods (JSON-RPC)
    const mcpMethodMap: Record<string, string> = {
      intent: 'tools/call',
      notify: 'ui/notify',
      prompt: 'ui/prompt',
      link: 'ui/open-link',
      update: 'ui/update',
      message: 'ui/message',
      'askAI': 'ui/message',
      tool: 'tools/call',
      'ui-size-change': 'ui/notifications/size-change',
      'resources/read': 'resources/read',
      'ui/message': 'ui/message',
      'ui/open-link': 'ui/open-link',
      'ui/update': 'ui/update',
      'tools/call': 'tools/call',
    };

    // Prepare response tracking (JSON-RPC ids come from messageId)
    let responsePromise: Promise<any> | null = null;
    if (messageId && options.awaitResponse) {
      const respTimeout = options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
      responsePromise = new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingResponses.current.delete(messageId);
          resolve({ ok: true, timeout: true, viaPostMessage: true });
        }, respTimeout);
        pendingResponses.current.set(messageId, { resolve, reject, timer });
      });
    }

    // For MCP Apps mode, send as JSON-RPC over postMessage
    if (isMcpUi && typeof window !== 'undefined' && window.parent !== window) {
      const mcpMethod = type.includes('/') ? type : (mcpMethodMap[type] || `ui/${type}`);
      log('[MCP Debug] sending MCP action via postMessage', { type, mcpMethod, messageId, params: actionPayload });
      const params =
        mcpMethod === 'tools/call'
          ? {
              name: actionPayload.tool || actionPayload.intent || actionPayload.name,
              arguments: actionPayload.params ?? actionPayload.arguments ?? actionPayload,
              messageId,
            }
          : actionPayload;
      const rpcEnvelope = messageId
        ? { jsonrpc: '2.0', id: messageId, method: mcpMethod, params }
        : { jsonrpc: '2.0', method: mcpMethod, params };
      try {
        window.parent.postMessage(rpcEnvelope, '*');
        log(`[MCP Debug] Sent MCP Apps action via postMessage: ${mcpMethod}`, actionPayload);
      } catch (err) {
        log(`[MCP Debug] Failed to send MCP Apps action ${mcpMethod} (non-critical)`, err);
      }
    }

    // Also send via BotDojo RPC channel for hosts that support it
    // This provides acknowledgment and response handling for BotDojo extensions
    const conn = connector as any;
    const hasRpcConnection = conn?.connection?.sendRequest;
    
    if (hasRpcConnection) {
      const functionName = normalizeMcpFunctionName(type);
      const shouldMirror = options.mirrorLegacyCanvasRpc ?? mirrorLegacy;
      const rpcTimeout = options.responseTimeoutMs && options.responseTimeoutMs > 0
        ? Math.min(options.responseTimeoutMs, 2000)
        : (isMcpUi ? 500 : 2000);

      // Send via RPC but don't block on it - the postMessage above is the primary path
      log('[MCP Debug] Mirroring MCP action via RPC', { type, functionName, messageId });
      const sendPromise = conn.connection.sendRequest('agent_host', functionName, [actionPayload], rpcTimeout)
        .catch((err: Error) => {
          // RPC timeout is expected in some scenarios - don't propagate as error
          if (err.message?.includes('Timeout')) {
            log(`[MCP Debug] RPC timeout for ${type} (non-critical, postMessage already sent)`);
            return { ok: true, timeout: true };
          }
          throw err;
        });

      if (shouldMirror && type !== 'ui-size-change') {
        const legacyMap: Record<string, string> = {
          intent: 'canvas_intent',
          notify: 'canvas_notify',
          prompt: 'canvas_prompt',
          link: 'canvas_link',
          update: 'canvas_update',
          message: 'canvas_message',
          'askAI': 'canvas_message',
        };
        const legacyName = legacyMap[type];
        if (legacyName) {
          sendCanvasAction(legacyName, payload).catch(() => undefined);
        }
      }

      // If awaiting response, wait for RPC but handle timeout gracefully
      if (responsePromise) {
        try {
          const sendResult = await sendPromise;
          if (messageId) {
            const pending = pendingResponses.current.get(messageId);
            if (pending) {
              handleMessageAck(messageId, 'responded', sendResult);
            }
          }
        } catch {
          // RPC failed but postMessage was sent - this is okay
        }
        return responsePromise;
      }
      
      return sendPromise;
    }

    // No RPC connection - postMessage was already sent above, return success
    if (isMcpUi) {
      return responsePromise || { ok: true, viaPostMessage: true };
    }

    throw new Error('No connector available');
  }, [connector, handleMessageAck, isMcpUi, log, mirrorLegacy, scheduleAckCleanup, sendCanvasAction]);

  const sendMessage = useCallback(async (text: string, params?: any, options?: CanvasActionOptions) => {
  
    log('sendMessage called', { text, params, mode });
    if (isMcpUi) {
      // Send MCP-UI verb for hosts that listen; also mirror to connector.run so the agent flow receives the message
      const payload = { text, params: params || {} };
      const mcpPromise = sendMcpUiAction('message', payload, { awaitResponse: true, ...options }).catch(err => {
        log('sendMcpUiAction(message) failed (non-blocking)', err);
        return undefined;
      });

      if (connector?.run) {
        const result = await connector.run({ text_input: text, ...params });
        emitEvent('message', result);
        await mcpPromise; // best-effort; don't block UI on MCP
        return result;
      }

      return mcpPromise;
    }
    if (!connector) {
      throw new Error('No connector available');
    }
    try {
      const result = await connector.run({ text_input: text, ...params });
      emitEvent('message', result);
      return result;
    } catch (err) {
      log('sendMessage error', err);
      setError(err as Error);
      emitEvent('error', err);
      throw err;
    }
  }, [connector, emitEvent, isMcpUi, log, mode, sendMcpUiAction]);

  const sendLink = useCallback((url: string, target: '_self' | '_blank' = '_blank', options?: CanvasActionOptions) => {
    log('sendLink called', { url, target });
    if (isMcpUi) {
      return sendMcpUiAction('link', { url, target }, options);
    }
    return sendCanvasAction('canvas_link', { url, target });
  }, [isMcpUi, sendCanvasAction, sendMcpUiAction, log]);

  const sendIntent = useCallback((intent: string, params?: Record<string, any>, options?: CanvasActionOptions) => {
    log('sendIntent called', { intent, params });
    if (isMcpUi) {
      return sendMcpUiAction('intent', { intent, params: params || {} }, { awaitResponse: true, ...options });
    }
    return sendCanvasAction('canvas_intent', { intent, params: params || {} });
  }, [isMcpUi, sendCanvasAction, sendMcpUiAction, log]);

  const sendNotify = useCallback((message: string, params?: Record<string, any>, options?: CanvasActionOptions) => {
    log('sendNotify called', { message, params });
    if (isMcpUi) {
      return sendMcpUiAction('notify', { message, params: params || {} }, options);
    }
    return sendCanvasAction('canvas_notify', { message, params: params || {} });
  }, [isMcpUi, sendCanvasAction, sendMcpUiAction, log]);

  const sendPrompt = useCallback((prompt: string, params?: Record<string, any>, options?: CanvasActionOptions) => {
    log('sendPrompt called', { prompt, params });
    if (isMcpUi) {
      return sendMcpUiAction('prompt', { prompt, params: params || {} }, { awaitResponse: true, ...options });
    }
    return sendCanvasAction('canvas_prompt', { prompt, params: params || {} });
  }, [isMcpUi, sendCanvasAction, sendMcpUiAction, log]);

  const sendUpdate = useCallback((data: any, options?: CanvasActionOptions) => {
    if (isMcpUi) {
      return sendMcpUiAction('update', data, options);
    }
    if (connector?.updateState) {
      return connector.updateState(data);
    }
    return sendCanvasAction('canvas_update', data);
  }, [connector, isMcpUi, sendCanvasAction, sendMcpUiAction]);

  const sendTool = useCallback((toolName: string, args?: any, options?: CanvasActionOptions) => {
    if (isMcpUi) {
      return sendMcpUiAction('tool', { tool: toolName, params: args }, { awaitResponse: true, ...options });
    }
    if (connector?.executeToolCall) {
      return connector.executeToolCall(toolName, args);
    }
    return sendCanvasAction(toolName, args);
  }, [connector, isMcpUi, sendCanvasAction, sendMcpUiAction]);

  const dispatchUIAction = useCallback((action: { type: string; payload?: any; messageId?: string }, options?: CanvasActionOptions) => {
    return sendMcpUiAction(action.type, action.payload, { messageId: action.messageId, ...options });
  }, [sendMcpUiAction]);

  useEffect(() => {
    if (!initialCanvasData) return;
    const derived = deriveStatusFromData(initialCanvasData);
    if (derived) {
      setToolStatus(derived);
    }
  }, [initialCanvasData, deriveStatusFromData]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return () => undefined;
    }

    const handleMessage = (event: MessageEvent) => {
      // Handle MCP Apps JSON-RPC responses
      if (isMcpUi && event.data?.jsonrpc === '2.0' && 'id' in event.data && !event.data.method) {
        const rpcId = String(event.data.id);
        if (pendingResponses.current.has(rpcId)) {
          const pending = pendingResponses.current.get(rpcId)!;
          if (pending.timer) window.clearTimeout(pending.timer);
          pendingResponses.current.delete(rpcId);
          if ('error' in event.data) {
            pending.reject(event.data.error);
            handleMessageAck(rpcId, 'error', undefined, event.data.error?.message);
          } else {
            pending.resolve(event.data.result);
            handleMessageAck(rpcId, 'responded', event.data.result);
          }
          scheduleAckCleanup(rpcId);
        }
        return;
      }

      // Handle raw MCP Apps protocol messages (from AppBridge)
      if (isMcpUi && event.data?.method && typeof event.data.method === 'string') {
        const { method, params } = event.data;
        log('Received MCP Apps protocol message:', method);
        
        if (method === 'ui/notifications/tool-input-partial' || method === 'ui/notifications/tool-input') {
          // Update canvasData with the tool arguments
          if (params?.arguments) {
            log('Updating canvasData from tool-input:', params.arguments);
            setCanvasData((prev: any) => ({ ...(prev || {}), ...params.arguments }));
            emitEvent('mcp-app:tool-input', params);
          }
          return;
        }
        if (method === 'ui/initialize') {
          log('Received ui/initialize', params);
          const capabilities =
            params?.hostCapabilities?.extensions?.['io.modelcontextprotocol/ui'] ||
            params?.capabilities?.extensions?.['io.modelcontextprotocol/ui'];
          const supportsMcpHtml = capabilities?.mimeTypes?.some((mime: string) =>
            mime === 'text/html+mcp' || mime === 'text/html;profile=mcp-app'
          );
          if (!capabilities || !supportsMcpHtml) {
            const err = new Error('Host does not advertise io.modelcontextprotocol/ui with text/html+mcp or text/html;profile=mcp-app');
            setError(err);
            if (event.data?.id) {
              (window.parent || window).postMessage(
                { jsonrpc: '2.0', id: event.data.id, error: { code: -32001, message: err.message } },
                '*'
              );
            }
            return;
          }
          // Extract initial data from hostContext (used for hydration/restoring persisted state)
          const hostContext = params?.hostContext;
          if (hostContext?.initialData) {
            log('Received initial data from hostContext (hydration):', hostContext.initialData);
            setCanvasData((prev: any) => ({ ...(prev || {}), ...hostContext.initialData }));
            emitEvent('mcp-app:initial-data', hostContext.initialData);
          }
          // Send initialized response/notification back
          if (event.data?.id) {
            (window.parent || window).postMessage(
              {
                jsonrpc: '2.0',
                id: event.data.id,
                result: {
                  clientInfo: { name: 'BotDojo Canvas', version: '1.0.0' },
                },
              },
              '*'
            );
          }
          if (window.parent !== window) {
            window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
          }
          return;
        }
        if (method === 'ui/notifications/host-context-changed' || method === 'ui/notifications/host-context-change') {
          log('Received host-context change', params);
          emitEvent('mcp-app:host-context-changed', params);
          return;
        }
        if (method === 'ui/tool-cancelled') {
          log('Received tool-cancelled', params);
          setIsExecuting(false);
          emitEvent('mcp-app:tool-cancelled', params);
          return;
        }
        if (method === 'ui/notifications/tool-result') {
          log('Received tool-result', params);
          setIsExecuting(false);
          emitEvent('mcp-app:tool-result', params);
          return;
        }
        // Other MCP Apps messages can be handled here
        return;
      }

      if (!event.data || event.data.type !== 'botdojo-rpc') {
        return;
      }
      const msg = event.data.payload;
      if (!msg || msg.direction !== 'request') {
        return;
      }

      if (isMcpUi && (msg.functionName === 'botdojo/tool_update' || msg.functionName === 'botdojo_tool_update')) {
        handleToolUpdate(msg.data?.[0]);
        return;
      }
      if (isMcpUi && msg.functionName?.startsWith('mcp_ui_')) {
        const payload = msg.data?.[0];
        const mcpType = msg.functionName.replace('mcp_ui_', '');
        if (mcpType === 'lifecycle_render_data') {
          setRenderData(payload);
          emitEvent('mcp-app:render-data', payload);
        }
        if (mcpType === 'message_received' && payload?.messageId) {
          handleMessageAck(payload.messageId, 'received', payload.payload ?? payload.data);
        }
        if (mcpType === 'message_response' && payload?.messageId) {
          handleMessageAck(payload.messageId, payload.error ? 'error' : 'responded', payload.payload ?? payload.data, payload.error);
        }
        return;
      }

      if (msg.functionName === 'onIntermediateStepUpdate') {
        const update = msg.data?.[0];
        if (update && (update.canvas || isExecuting)) {
          if (update.canvas) {
            setIsExecuting(true);
            if (update.canvas.canvasData) {
              setCanvasData((prev: any) => ({ ...(prev || {}), ...update.canvas.canvasData }));
              if (!update.stepStatus) {
                const derived = deriveStatusFromData(update.canvas.canvasData);
                if (derived) {
                  setToolStatus(derived);
                }
              }
            }
          }
          if ('toolPhase' in update) {
            setToolPhase(update.toolPhase);
          }
          if (update.stepStatus) {
            const status = update.stepStatus === 'complete' ? 'complete' : update.stepStatus === 'error' ? 'error' : 'processing';
            setToolStatus(status);
            if (status === 'complete' || status === 'error') {
              setIsExecuting(false);
            }
          }
          if (update.error) {
            setToolError(update.error);
          }
          if (update.argumentStream) {
            setPartialArguments(update.argumentStream);
            try {
              setParsedArguments(JSON.parse(update.argumentStream));
            } catch {
              // ignore
            }
          }
          if (update.arguments && update.toolPhase === 'executing') {
            try {
              const parsed = typeof update.arguments === 'string' ? JSON.parse(update.arguments) : update.arguments;
              setParsedArguments(parsed);
            } catch (e) {
              log('Error parsing arguments:', e);
            }
          }
        }
        return;
      }

      if (msg.functionName === 'onNewToken') {
        const tokenUpdate = msg.data?.[0];
        if (tokenUpdate?.toolArguments) {
          setPartialArguments(tokenUpdate.toolArguments);
          try {
            setParsedArguments(JSON.parse(tokenUpdate.toolArguments));
          } catch {
            // ignore
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    log('Listening for flow events from parent');
    return () => {
      window.removeEventListener('message', handleMessage);
      log('Stopped listening for flow events');
    };
  }, [deriveStatusFromData, emitEvent, handleMessageAck, handleToolUpdate, isExecuting, isMcpUi, log]);

  const reportSize = useCallback((conn: any) => {
    if (typeof window === 'undefined') {
      return;
    }
    const body = document.body;
    const html = document.documentElement;
    const height = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
    const width = Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);
    setUiSize({ width, height });
    
    // For MCP Apps mode, send size change directly via postMessage using MCP Apps protocol
    // This is required because AppBridge on the host listens for ui/notifications/size-change
    if (isMcpUi && window.parent !== window) {
      try {
        window.parent.postMessage({
          jsonrpc: '2.0',
          method: 'ui/notifications/size-change',
          params: { width, height },
        }, '*');
        log('Sent MCP Apps size-change notification', { width, height });
      } catch (err) {
        log('Failed to send MCP Apps size-change (non-critical)', err);
      }
      // Also try the BotDojo RPC channel for legacy support
      sendMcpUiAction('ui-size-change', { width, height }, { mirrorLegacyCanvasRpc: mirrorLegacy }).catch(() => undefined);
      return;
    }
    
    if (!conn?.connection) {
      return;
    }
    conn.connection.sendRequest('agent_host', 'canvas_resize', [{ width, height }], 2000).catch((err: Error) => {
      if (!err.message?.includes('timeout')) {
        console.warn('[BotDojoCanvas] canvas_resize failed (non-critical):', err);
      }
    });
  }, [isMcpUi, log, mirrorLegacy, sendMcpUiAction]);

  useEffect(() => {
    if (!connector || typeof window === 'undefined') {
      return () => undefined;
    }
    const initialTimer = window.setTimeout(() => {
      reportSize(connector);
    }, 100);
    const observer = new ResizeObserver(() => {
      reportSize(connector);
    });
    observer.observe(document.body);
    return () => {
      window.clearTimeout(initialTimer);
      observer.disconnect();
    };
  }, [connector, reportSize, canvasData]);

  useEffect(() => {
    return () => {
      if (isMcpUi && typeof window !== 'undefined' && window.parent !== window) {
        try {
          window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/resource-teardown', params: {} }, '*');
        } catch {
          // ignore teardown errors
        }
      }
    };
  }, [isMcpUi]);

  useEffect(() => {
    return () => {
      pendingResponses.current.forEach(({ timer }) => {
        if (timer) window.clearTimeout(timer);
      });
      cleanupTimers.current.forEach(timer => window.clearTimeout(timer));
      pendingResponses.current.clear();
      cleanupTimers.current.clear();
    };
  }, []);

  const on = useCallback((event: CanvasEvent, handler: (data: any) => void) => {
    if (!eventHandlers.has(event)) {
      eventHandlers.set(event, new Set());
    }
    const handlers = eventHandlers.get(event)!;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }, [eventHandlers]);

  const contextValue = useMemo(() => ({
    isReady,
    error,
    canvasData: canvasData || null,
    renderData,
    lastAck,
    messageIdMap,
    uiSize,
    mode,
    connector: connector || null,
    isMockMode: false,
    sendMessage,
    sendLink,
    sendIntent,
    sendNotify,
    sendPrompt,
    sendTool,
    sendUpdate,
    dispatchUIAction,
    on,
    toolPhase,
    toolStatus,
    partialArguments,
    parsedArguments,
    toolError,
  }), [canvasData, connector, dispatchUIAction, error, isReady, lastAck, messageIdMap, mode, on, parsedArguments, partialArguments, renderData, sendIntent, sendLink, sendMessage, sendNotify, sendPrompt, sendTool, sendUpdate, toolError, toolPhase, toolStatus, uiSize]);

  return (
    <CanvasContext.Provider value={contextValue}>
      {children}
    </CanvasContext.Provider>
  );
}
