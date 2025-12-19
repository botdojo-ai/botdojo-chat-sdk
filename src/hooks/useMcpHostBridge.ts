/**
 * useMcpHostBridge - React hook for hosting MCP Apps in iframes
 * 
 * Encapsulates all iframe lifecycle management, JSON-RPC communication,
 * and MCP protocol handling. This is the consolidated implementation
 * that both McpAppHost and McpAppCanvas can use.
 * 
 * Per MCP spec (SEP-1865), web hosts MUST use a sandbox proxy with a different
 * origin. Blob URLs are not supported as they have null origin.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_MCP_HOST_CAPABILITIES,
  parseMaybeJson,
  validateToolParams,
  processStepUpdate,
  type StepUpdate,
  type ToolNotification,
} from '../utils/mcpUtils';

/**
 * Iframe lifecycle states
 */
export type IframeState = 'idle' | 'loading' | 'initializing' | 'ready';

/**
 * Tool info for hydration
 */
export interface ToolInfo {
  id?: string | number;
  tool: { name: string; description?: string; inputSchema?: Record<string, unknown> };
}

/**
 * Options for useMcpHostBridge hook
 */
export interface UseMcpHostBridgeOptions {
  /** Unique identifier for this MCP App instance */
  appId: string;
  
  /** 
   * URL for the app (proxy URL for ui:// resources, or direct HTTP URL).
   * Required for rendering - if not provided, no iframe will be rendered.
   */
  url?: string;
  
  /** 
   * HTML content - only used for sandbox-resource-ready response, not for iframe src.
   * The proxy will request this via sandbox-resource message.
   */
  html?: string;
  
  /** Tool info for hydration */
  toolInfo?: ToolInfo;
  
  /** Tool arguments for hydration */
  arguments?: any;
  
  /** Tool result for hydration */
  result?: any;
  
  /** Persisted state to restore */
  state?: any;
  
  /** Whether the tool is complete */
  isComplete?: boolean;
  
  /** Called when app requests to open a link */
  onOpenLink?: (url: string, target: string) => void;
  
  /** Called when app requests a tool execution */
  onToolCall?: (tool: string, params: any) => Promise<any>;
  
  /** Called when app sends a UI message */
  onMessage?: (message: string, params: any) => void;
  
  /** Called when app wants to persist state */
  onPersistState?: (state: any) => void;
  
  /** Called when app reports size change */
  onSizeChange?: (width: number, height: number) => void;
  
  /** Called when app is initialized and ready */
  onReady?: () => void;
  
  /** Additional host context */
  hostContext?: Record<string, any>;
  
  /** Enable debug logging and error display */
  debug?: boolean;
  
  /**
   * Called when proxy requests a sandbox resource (ui/requests/sandbox-resource).
   * Should return the resolved HTML content for the resource.
   */
  onSandboxResourceRequest?: (params: {
    resource: string;
    flowId?: string;
  }) => Promise<{ html?: string; sandbox?: string; csp?: string } | string | null>;
}

/**
 * Return value from useMcpHostBridge hook
 */
export interface UseMcpHostBridgeResult {
  /** Ref to attach to the iframe element */
  iframeRef: React.RefObject<HTMLIFrameElement>;
  
  /** Current iframe state */
  status: IframeState;
  
  /** Auto-detected height from app */
  autoHeight: number | null;
  
  /** Handle iframe onLoad event */
  handleIframeLoad: () => void;
  
  /** Send a tool notification to the app */
  sendToolNotification: (method: string, params: any) => void;
  
  /** Process and send step update notifications */
  sendStepUpdate: (stepUpdate: StepUpdate) => void;
  
  /** The computed src for the iframe (proxy URL) */
  iframeSrc: string | undefined;
  
  /** Error message if rendering is not possible (null if OK) */
  renderError: string | null;
  
  /** Convenience boolean - true if iframeSrc is valid and no render error */
  canRender: boolean;
  
  /** True if initialization timed out */
  initFailed: boolean;
  
  /** Detailed initialization error message */
  initError: string | null;
  
  /** Reset iframe state to retry rendering */
  resetIframe: () => void;
}

/**
 * Hook for hosting MCP Apps in iframes with full JSON-RPC communication.
 * Handles initialization, hydration, tool notifications, and lifecycle management.
 */
export function useMcpHostBridge(options: UseMcpHostBridgeOptions): UseMcpHostBridgeResult {
  const {
    appId,
    html,
    url,
    toolInfo,
    arguments: toolArguments,
    result: toolResult,
    state,
    isComplete,
    onOpenLink,
    onToolCall,
    onMessage,
    onPersistState,
    onSizeChange,
    onReady,
    hostContext,
    debug = false,
    onSandboxResourceRequest,
  } = options;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeState, setIframeState] = useState<IframeState>('idle');
  const [autoHeight, setAutoHeight] = useState<number | null>(null);
  
  // Error state for rendering issues
  const [renderError, setRenderError] = useState<string | null>(null);
  
  // Initialization failure state
  const [initFailed, setInitFailed] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  
  // Pending requests for JSON-RPC
  const pendingRequestsRef = useRef<Map<string, {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timer?: ReturnType<typeof setTimeout>;
  }>>(new Map());
  const nextRequestIdRef = useRef(0);
  
  // Initialize retry state
  const initializeAttemptsRef = useRef(0);
  const initializeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Notification queue for before iframe is ready
  const pendingNotificationsRef = useRef<Array<{ method: string; params: any }>>([]);
  
  // Cache for sandbox resource HTML (proxy flow)
  const sandboxResourceCacheRef = useRef<Map<string, { html: string; sandbox?: string; csp?: string }>>(new Map());
  
  // Track iframe state via ref for async callbacks
  const iframeStateRef = useRef<IframeState>(iframeState);
  iframeStateRef.current = iframeState;
  
  // Content tracking for change detection - only based on URL now (no blob URLs)
  const contentKey = useMemo(() => url ? `url:${url}` : 'empty', [url]);
  const renderedContentKeyRef = useRef<string>('');
  
  // Computed iframe src
  const [iframeSrc, setIframeSrc] = useState<string | undefined>(undefined);
  
  // Computed canRender - true if we have a valid src and no errors
  const canRender = !!iframeSrc && !renderError;

  const log = useCallback((...args: any[]) => {
    if (debug) {
      console.log(`[useMcpHostBridge:${appId}]`, ...args);
    }
  }, [debug, appId]);

  // === JSON-RPC Communication ===

  const sendResponse = useCallback((id: string | number, result: any) => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ jsonrpc: '2.0', id, result }, '*');
  }, []);

  const sendError = useCallback((id: string | number, code: number, message: string) => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({ jsonrpc: '2.0', id, error: { code, message } }, '*');
  }, []);

  const sendNotification = useCallback((method: string, params?: any) => {
    if (!iframeRef.current?.contentWindow) return;
    log('Sending notification:', method);
    iframeRef.current.contentWindow.postMessage({ jsonrpc: '2.0', method, params }, '*');
  }, [log]);

  const sendRequest = useCallback((method: string, params?: any, timeout: number = 5000): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!iframeRef.current?.contentWindow) {
        reject(new Error('Iframe not ready'));
        return;
      }
      
      const id = `host-${++nextRequestIdRef.current}`;
      const timer = setTimeout(() => {
        pendingRequestsRef.current.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeout);
      
      pendingRequestsRef.current.set(id, { resolve, reject, timer });
      
      log('Sending request:', method);
      iframeRef.current.contentWindow.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }, [log]);

  // === Tool Notification Sending ===

  const sendToolNotification = useCallback((method: string, params: any) => {
    // Validate before sending
    const kind = method.includes('result') ? 'result' : method.includes('partial') ? 'partial' : 'input';
    if (!validateToolParams(params, kind)) {
      log('Skipping invalid notification:', method);
      return;
    }
    
    if (iframeStateRef.current === 'ready' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ jsonrpc: '2.0', method, params }, '*');
    } else {
      pendingNotificationsRef.current.push({ method, params });
    }
  }, [log]);

  const sendStepUpdate = useCallback((stepUpdate: StepUpdate) => {
    const notifications = processStepUpdate(stepUpdate);
    notifications.forEach(({ method, params }) => {
      sendToolNotification(method, params);
    });
  }, [sendToolNotification]);

  // === Initialization ===

  const sendInitialize = useCallback(() => {
    if (iframeStateRef.current === 'ready' || !iframeRef.current?.contentWindow) return;
    
    const context = {
      mcpAppId: appId,
      state,
      toolInfo,
      ...hostContext,
    };
    
    const params = {
      protocolVersion: 'mcp-apps/0.1',
      appInfo: { name: 'McpAppHost', version: '1.0.0' },
      hostCapabilities: DEFAULT_MCP_HOST_CAPABILITIES,
      hostContext: context,
    };
    
    log('Sending ui/initialize');
    sendRequest('ui/initialize', params, 2000).catch((err) => {
      log('ui/initialize failed:', err.message);
    });
  }, [appId, state, toolInfo, hostContext, log, sendRequest]);

  const sendInitializeWithRetry = useCallback(() => {
    if (iframeStateRef.current === 'ready') return;
    
    const attemptSend = () => {
      if (iframeStateRef.current === 'ready') return;
      
      initializeAttemptsRef.current += 1;
      sendInitialize();
      
      if (initializeAttemptsRef.current < 5) {
        initializeTimerRef.current = setTimeout(attemptSend, 300);
      } else {
        initializeTimerRef.current = null;
        log('Max initialize attempts reached');
      }
    };
    
    if (initializeTimerRef.current !== null) {
      clearTimeout(initializeTimerRef.current);
    }
    initializeAttemptsRef.current = 0;
    attemptSend();
  }, [sendInitialize, log]);

  // === Hydration ===

  const sendHydrationData = useCallback(() => {
    const toolName = toolInfo?.tool?.name;
    if (!toolName || !iframeRef.current?.contentWindow) return;
    
    const args = parseMaybeJson(toolArguments);
    const result = parseMaybeJson(toolResult);
    
    log('Sending hydration data:', { toolName, hasArgs: !!args, hasResult: !!result });
    
    // Send tool-input
    if (args && typeof args === 'object' && Object.keys(args).length > 0) {
      iframeRef.current.contentWindow.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-input',
        params: { tool: { name: toolName }, arguments: args },
      }, '*');
    }
    
    // Send tool-result
    if (result !== undefined && result !== '') {
      iframeRef.current.contentWindow.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { tool: { name: toolName }, result },
      }, '*');
    } else if (isComplete) {
      // Synthetic result for completed tools without stored result
      iframeRef.current.contentWindow.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { tool: { name: toolName }, result: { completed: true } },
      }, '*');
    }
  }, [toolInfo, toolArguments, toolResult, isComplete, log]);

  // === Message Handling ===

  const handleMessage = useCallback((event: MessageEvent) => {
    if (debug) {
      console.log(`[useMcpHostBridge:${appId}] raw message`, { origin: event.origin, data: event.data });
    }
    // Accept any JSON-RPC message (some browsers give a different Window proxy)
    if (!event.data || event.data.jsonrpc !== '2.0') return;
    const data = event.data;

    // Handle JSON-RPC response
    if ('id' in data && !('method' in data)) {
      const pending = pendingRequestsRef.current.get(String(data.id));
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        pendingRequestsRef.current.delete(String(data.id));
        if ('error' in data) {
          pending.reject(data.error);
        } else {
          pending.resolve(data.result);
        }
      }
      return;
    }

    const { method, params, id } = data;
    log('Received:', method);

    switch (method) {
      case 'ui/notifications/client-ready': {
        // App signals it is ready to receive ui/initialize
        log('App reported client-ready; triggering initialize');
        sendInitializeWithRetry();
        break;
      }

      case 'ui/notifications/sandbox-ready':
      case 'ui/notifications/sandbox-proxy-ready': {
        // Proxy is ready - if we have HTML, send it via sandbox-resource-ready
        log('Proxy reported sandbox-ready');
        const resource = params?.resource;
        if (resource && html) {
          log('Sending sandbox-resource-ready with inline HTML for:', resource);
          sendNotification('ui/notifications/sandbox-resource-ready', {
            resource,
            html,
            sandbox: 'allow-scripts allow-same-origin',
          });
        }
        break;
      }

      case 'ui/requests/sandbox-resource': {
        // Proxy is requesting HTML content for a resource
        const resource = params?.resource;
        const flowId = params?.flowId;
        log('Proxy requesting sandbox-resource:', resource);
        
        if (!resource) break;
        
        const cacheKey = `${flowId || 'unknown'}|${resource}`;
        
        // Check cache first
        if (sandboxResourceCacheRef.current.has(cacheKey)) {
          const cached = sandboxResourceCacheRef.current.get(cacheKey)!;
          log('Using cached sandbox resource for:', resource);
          sendNotification('ui/notifications/sandbox-resource-ready', {
            resource,
            flowId,
            ...cached,
          });
          break;
        }
        
        // If we have inline HTML already, use it
        if (html) {
          log('Using inline HTML for sandbox-resource:', resource);
          const entry = {
            html,
            sandbox: 'allow-scripts allow-same-origin',
          };
          sandboxResourceCacheRef.current.set(cacheKey, entry);
          sendNotification('ui/notifications/sandbox-resource-ready', {
            resource,
            flowId,
            ...entry,
          });
          break;
        }
        
        // Otherwise, call the callback to resolve the resource
        if (onSandboxResourceRequest) {
          (async () => {
            try {
              log('Calling onSandboxResourceRequest for:', resource);
              const resolved = await onSandboxResourceRequest({ resource, flowId });
              const payload = typeof resolved === 'string' ? { html: resolved } : resolved;
              if (payload?.html) {
                log('Got HTML from onSandboxResourceRequest for:', resource, 'length:', payload.html.length);
                const entry = {
                  html: payload.html,
                  sandbox: payload.sandbox || 'allow-scripts allow-same-origin',
                  csp: payload.csp,
                };
                sandboxResourceCacheRef.current.set(cacheKey, entry);
                sendNotification('ui/notifications/sandbox-resource-ready', {
                  resource,
                  flowId,
                  ...entry,
                });
              } else {
                log('onSandboxResourceRequest returned no HTML for:', resource);
              }
            } catch (err) {
              console.warn('[useMcpHostBridge] Failed to resolve sandbox resource:', err);
            }
          })();
        } else {
          log('No onSandboxResourceRequest handler and no inline HTML for:', resource);
        }
        break;
      }

      case 'ui/notifications/initialized': {
        log('App confirmed initialization');
        if (initializeTimerRef.current !== null) {
          clearTimeout(initializeTimerRef.current);
          initializeTimerRef.current = null;
        }
        setIframeState('ready');
        
        // Send hydration data
        sendHydrationData();
        
        // Replay queued notifications
        if (pendingNotificationsRef.current.length > 0 && iframeRef.current?.contentWindow) {
          log(`Replaying ${pendingNotificationsRef.current.length} queued notifications`);
          pendingNotificationsRef.current.forEach(({ method, params }) => {
            iframeRef.current!.contentWindow!.postMessage({ jsonrpc: '2.0', method, params }, '*');
          });
          pendingNotificationsRef.current = [];
        }
        
        onReady?.();
        break;
      }

      case 'ui/initialize': {
        // Legacy: some apps send ui/initialize as a request
        log('Handling ui/initialize request from app');
        
        sendResponse(id, {
          appInfo: { name: 'McpAppHost', version: '1.0.0' },
          hostCapabilities: DEFAULT_MCP_HOST_CAPABILITIES,
          hostContext: { state, toolInfo, ...hostContext },
        });
        
        sendNotification('ui/notifications/initialized', {});
        
        if (initializeTimerRef.current !== null) {
          clearTimeout(initializeTimerRef.current);
          initializeTimerRef.current = null;
        }
        setIframeState('ready');
        onReady?.();
        break;
      }

      case 'ui/open-link': {
        if (params?.url) {
          onOpenLink?.(params.url, params.target || '_blank');
        }
        if (id !== undefined) {
          sendResponse(id, { ok: true });
        }
        break;
      }

      case 'tools/call': {
        const toolName = params?.name || params?.tool;
        const toolParams = params?.arguments || params?.params || {};
        
        if (onToolCall && toolName) {
          Promise.resolve(onToolCall(toolName, toolParams))
            .then(result => {
              if (id !== undefined) {
                sendResponse(id, result ?? { ok: true });
              }
            })
            .catch(err => {
              if (id !== undefined) {
                sendError(id, -32000, err.message || 'Tool execution failed');
              }
            });
        } else {
          if (id !== undefined) {
            sendResponse(id, { ok: false, error: 'No tool handler' });
          }
        }
        break;
      }

      case 'ui/message': {
        const contentArray = Array.isArray(params?.content) ? params.content : [params?.content].filter(Boolean);
        const firstContent = contentArray[0];
        
        // Handle persist-state messages
        if (firstContent?.['botdojo/messageType'] === 'persist-state' && typeof firstContent.text === 'string') {
          try {
            const parsed = JSON.parse(firstContent.text);
            onPersistState?.(parsed);
          } catch { /* ignore parse errors */ }
          if (id !== undefined) sendResponse(id, { ok: true });
          break;
        }
        
        if (firstContent?.type === 'botdojo/persist' && firstContent.state) {
          onPersistState?.(firstContent.state);
          if (id !== undefined) sendResponse(id, { ok: true });
          break;
        }
        
        // Regular message
        const text = firstContent?.text || JSON.stringify(params);
        onMessage?.(text, params);
        if (id !== undefined) sendResponse(id, { ok: true });
        break;
      }

      case 'ui/size-change':
      case 'ui/notifications/size-change': {
        if (params?.height) {
          setAutoHeight(params.height);
        }
        if (params?.width && params?.height) {
          onSizeChange?.(params.width, params.height);
        }
        break;
      }

      default: {
        if (id !== undefined) {
          sendResponse(id, { ok: true, ignored: true });
        }
      }
    }
  }, [
    log,
    state,
    toolInfo,
    hostContext,
    html,
    onOpenLink,
    onToolCall,
    onMessage,
    onPersistState,
    onSizeChange,
    onReady,
    onSandboxResourceRequest,
    sendResponse,
    sendError,
    sendNotification,
    sendHydrationData,
    sendInitializeWithRetry,
    appId,
    debug,
  ]);

  // === Effects ===

  // Set up message listener
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Handle content changes - only run when URL changes
  // Per MCP spec, we only support proxy URLs (no blob URLs)
  useEffect(() => {
    log('Content effect running:', { contentKey, renderedContentKey: renderedContentKeyRef.current, url });
    
    // Skip if content key unchanged
    if (contentKey === renderedContentKeyRef.current) {
      log('Skipping - content key unchanged');
      return;
    }
    
    // Preserve working iframe when URL becomes empty during re-render
    if (contentKey === 'empty' && renderedContentKeyRef.current !== '' && iframeSrc) {
      log('URL became empty but iframe has content, preserving');
      return;
    }
    
    log('Content key changed:', { old: renderedContentKeyRef.current, new: contentKey });
    renderedContentKeyRef.current = contentKey;
    
    // Reset state
    setIframeState('idle');
    setAutoHeight(null);
    setInitFailed(false);
    setInitError(null);
    initializeAttemptsRef.current = 0;
    pendingNotificationsRef.current = [];
    if (initializeTimerRef.current !== null) {
      clearTimeout(initializeTimerRef.current);
      initializeTimerRef.current = null;
    }
    
    // Only use proxy URL - blob URLs not supported per MCP spec
    if (url) {
      log('Using proxy URL:', url);
      setIframeSrc(url);
      setRenderError(null);
    } else {
      // No URL means we can't render
      log('No URL provided - parent must build proxy URL for ui:// resources');
      setIframeSrc(undefined);
      setRenderError('No proxy URL available for MCP App');
    }
  }, [contentKey, url, log, iframeSrc]);

  // Send initialize when iframe loads
  useEffect(() => {
    if (iframeState === 'loading') {
      log('Iframe loaded, sending ui/initialize');
      setIframeState('initializing');
      sendInitializeWithRetry();
    }
  }, [iframeState, sendInitializeWithRetry, log]);

  // Initialization timeout detection
  useEffect(() => {
    if (iframeState === 'initializing') {
      const timeout = setTimeout(() => {
        if (iframeStateRef.current === 'initializing') {
          log('Initialization timeout after 5 seconds');
          setIframeState('idle');
          setInitFailed(true);
          setInitError('MCP App initialization timed out after 5 seconds');
        }
      }, 5000);
      return () => clearTimeout(timeout);
    } else if (iframeState === 'ready') {
      setInitFailed(false);
      setInitError(null);
    }
  }, [iframeState, log]);

  // Reset iframe function for retry
  const resetIframe = useCallback(() => {
    log('Resetting iframe for retry');
    setInitFailed(false);
    setInitError(null);
    setRenderError(null);
    renderedContentKeyRef.current = '';
    setIframeState('idle');
    // Re-trigger content effect by clearing and re-setting src
    setIframeSrc(undefined);
    // Force re-evaluation on next tick
    setTimeout(() => {
      if (url) {
        setIframeSrc(url);
      }
    }, 0);
  }, [log, url]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (initializeTimerRef.current !== null) {
        clearTimeout(initializeTimerRef.current);
      }
      pendingRequestsRef.current.forEach(({ timer, reject }) => {
        if (timer) clearTimeout(timer);
        reject(new Error('Component unmounted'));
      });
      pendingRequestsRef.current.clear();
    };
  }, []);

  // Handle iframe onLoad
  const handleIframeLoad = useCallback(() => {
    log('Iframe onLoad fired');
    setIframeState((prev) => prev === 'idle' ? 'loading' : prev);
  }, [log]);

  return {
    iframeRef,
    status: iframeState,
    autoHeight,
    handleIframeLoad,
    sendToolNotification,
    sendStepUpdate,
    iframeSrc,
    renderError,
    canRender,
    initFailed,
    initError,
    resetIframe,
  };
}
