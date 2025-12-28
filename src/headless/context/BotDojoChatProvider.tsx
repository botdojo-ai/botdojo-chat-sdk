/**
 * BotDojo Chat Provider
 * 
 * Main provider component for Headless Chat with full RPC/Connector support.
 * 
 * This component:
 * 1. Creates a hidden iframe with /embed/headless for all communication
 * 2. Manages MCP App iframe bridges for rendering
 * 3. Listens to postMessage events from iframe
 * 4. Updates React state via reducer
 * 5. Exposes state and actions via context
 * 
 * Architecture:
 * - /embed/headless handles:
 *   - Flow Request Channel: HTTP streaming for tokens, steps, flow completion
 *   - External UI Channel: Socket.IO for model context registration and tool calls
 * - HeadlessEmbed connects to Socket.IO and proxies tool calls to parent
 * - Parent executes tools locally and sends results back
 */

import React, { createContext, useReducer, useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { chatReducer, initialState } from './chatReducer';
import {
  BotDojoChatContextType,
  BotDojoChatProviderProps,
  HeadlessEvent,
  HeadlessAction,
} from '../types/headless';

// Import RPC and Connector dependencies
import { BotDojoConnector } from '../../connector';
import { extractUiCspFromResource, resolveUiCsp, buildMcpProxyUrl } from '../../utils';
import { translateModelContextToBackend, ToolExecutionContext, FlowRequestStep } from '../../generated/sdk-types-snapshot';

/**
 * Extended step type that includes raw server properties not in the SDK type
 * The server sends `arguments` as a string, while SDK uses `stepToolArguments` as parsed object
 */
interface RawServerStep extends FlowRequestStep {
  /** Raw arguments string from server (JSON stringified) */
  arguments?: string;
}
import { 
  RPCConnection, 
  RPCMessage,
  PostMessageBridge,
  generateUUID,
} from 'botdojo-rpc';

export const BotDojoChatContext = createContext<BotDojoChatContextType | null>(null);

export function BotDojoChatProvider(props: BotDojoChatProviderProps): JSX.Element {
  const {
    apiKey,
    modelContext,
    baseUrl = typeof window !== 'undefined' 
      ? (window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://embed.botdojo.com')
      : 'https://embed.botdojo.com',
    sessionId,
    newSession = false,
    children,
    onError,
    onReady,
    onSessionCreated,
    onSessionHydrated,
    onConnectorInit,
    onConnectorError,
    // Debug mode for MCP App rendering
    debug = false,
    // Cache key for MCP proxy URLs
    cacheKey,
    // MCP App handlers (SEP-1865)
    onOpenLink,
    onToolCall,
    onUiMessage,
  } = props;

  const [state, dispatch] = useReducer(chatReducer, initialState);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isIframeReady, setIsIframeReady] = useState(false);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  
  // Generate a unique external UI channel ID for Socket.IO communication
  const externalUIChannelIdRef = useRef<string>(generateUUID());
  
  // Connector and RPC refs/state (kept for backwards compatibility)
  const connectorRef = useRef<BotDojoConnector | null>(null);
  const connectionRef = useRef<RPCConnection | null>(null);
  const [connector, setConnector] = useState<BotDojoConnector | null>(null);
  const [isConnectorReady, setIsConnectorReady] = useState(false);
  const [isModelContextRegistered, setIsModelContextRegistered] = useState(false);

  // MCP App bridge management
  const appBridgesRef = useRef<Map<string, PostMessageBridge>>(new Map());
  const appIframeRefsRef = useRef<Map<string, Window>>(new Map());
  const pendingAppEventsRef = useRef<Map<string, any[]>>(new Map());
  const [registeredMcpApps, setRegisteredMcpApps] = useState<Set<string>>(new Set());
  
  // Tool notification callbacks for streaming updates to MCP Apps
  // McpAppHost registers its notification sender when mounted
  const toolNotificationSendersRef = useRef<Map<string, (method: string, params: any) => void>>(new Map());
  
  // Step update callbacks - each MCP App registers a callback to receive targeted updates
  // This is the preferred way to send updates to specific apps (vs broadcasting)
  const stepUpdateCallbacksRef = useRef<Map<string, (stepUpdate: any) => void>>(new Map());
  
  // Track active MCP App for each tool name - used to route executeToolCall notifications
  // When a step_update comes with app info, we register the appId for that toolName
  // Key: toolName (with prefix), Value: appId
  const activeAppByToolRef = useRef<Map<string, string>>(new Map());
  
  // Track stepId → appId mapping - used to forward step updates that don't have canvas
  // (e.g., notifyToolInputPartial sends step updates without canvas)
  const stepIdToAppIdRef = useRef<Map<string, string>>(new Map());
  
  // Queue for tool notifications sent BEFORE an MCP App is registered
  // Key: appId, Value: array of { method, params } to replay
  // When McpAppHost mounts and registers, we replay these queued notifications
  const pendingToolNotificationsRef = useRef<Map<string, Array<{ method: string; params: any }>>>(new Map());
  
  // Queue for broadcast notifications (when we don't know the appId yet)
  // These get replayed to ALL newly registered MCP Apps
  const pendingBroadcastNotificationsRef = useRef<Array<{ method: string; params: any; toolName: string }>>([]);
  
  // Cache for tool arguments - keyed by toolName or appId
  // When executeToolCall is called, we cache the args for later use in step_update hydration
  const toolArgumentsCacheRef = useRef<Map<string, any>>(new Map());
  
  // Cache for MCP App data - keyed by appId
  // This is the single source of truth for MCP App data (HTML, arguments, result, etc.)
  // McpAppHost gets its data from here via getMcpAppData() instead of props
  // This eliminates the need for parents to pass mcpAppData props
  const mcpAppDataCacheRef = useRef<Map<string, {
    html?: string;
    url?: string;
    arguments?: any;
    result?: any;
    isComplete?: boolean;
    toolInfo?: { tool: { name: string } };
    height?: string;
    width?: string;
    state?: any;
  }>>(new Map());
  
  // Version counter to trigger re-renders when MCP App data cache is updated
  // Components like McpAppHost can use this to know when to re-read from the cache
  const [mcpAppDataVersion, setMcpAppDataVersion] = useState(0);
  
  // Queue for step updates sent BEFORE an MCP App's stepUpdateCallback is registered
  // Key: appId, Value: array of step updates to replay when McpAppHost mounts
  const pendingStepUpdatesRef = useRef<Map<string, any[]>>(new Map());
  
  // MCP App handlers (stored in ref to avoid re-renders)
  const appHandlersRef = useRef({
    onOpenLink,
    onToolCall,
    onUiMessage,
  });
  
  // Keep model context in a ref for access in callbacks
  const modelContextRef = useRef(modelContext);
  useEffect(() => {
    modelContextRef.current = modelContext;
  }, [modelContext]);

  // Debug logging helper - only logs when debug prop is true
  const debugLog = useCallback((...args: any[]) => {
    if (debug) console.log('[BotDojoChatProvider]', ...args);
  }, [debug]);

  // Build headless iframe URL
  // HeadlessEmbed handles both HTTP streaming (flow request) and Socket.IO (external UI channel)
  const iframeUrl = useMemo(() => {
    const url = new URL('/embed/headless', baseUrl);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('externalUIChannelId', externalUIChannelIdRef.current);
    if (sessionId) url.searchParams.set('session-id', sessionId);
    if (newSession) url.searchParams.set('new-session', 'true');
    return url.toString();
  }, [apiKey, baseUrl, sessionId, newSession]);
  
  // Update app handlers ref when props change
  useEffect(() => {
    appHandlersRef.current = {
      onOpenLink,
      onToolCall,
      onUiMessage,
    };
  }, [onOpenLink, onToolCall, onUiMessage]);

  // Note: We no longer use BotDojoConnector directly.
  // HeadlessEmbed connects via Socket.IO and handles model context registration.
  // Tool calls are routed from HeadlessEmbed → Parent (via PostMessage) → execute locally
  
  // Mark connector as "ready" when HeadlessEmbed Socket.IO is connected (for backwards compatibility)
  useEffect(() => {
    if (isSocketConnected && modelContext) {
      setIsConnectorReady(true);
    }
  }, [isSocketConnected, modelContext]);

  // Handle headless iframe load
  const handleIframeLoad = useCallback(() => {
    debugLog(' Headless iframe loaded');
    setIsIframeReady(true);
  }, []);
  
  // Helper to serialize model context for sending via postMessage
  // Uses translateModelContextToBackend for proper format, then strips functions
  const serializeModelContext = useCallback((ctx: any) => {
    // Use the same translation as BotDojoConnector
    const backendFormat = translateModelContextToBackend(ctx);
    
    // Strip execute functions from tools for postMessage serialization
    const tools = (backendFormat.tools || []).map((tool: any) => {
      const { execute, ...toolWithoutExecute } = tool;
      return toolWithoutExecute;
    });
    
    return {
      ...backendFormat,
      tools,
      uri: backendFormat.resourceUri,
    };
  }, []);
  
  // Send model context to HeadlessEmbed iframe
  const sendModelContextToHeadless = useCallback(() => {
    if (!iframeRef.current?.contentWindow || !modelContextRef.current) {
      return;
    }
    
    const contexts = Array.isArray(modelContextRef.current) 
      ? modelContextRef.current 
      : [modelContextRef.current];
    
    // Send first context (we can extend to support multiple later)
    const ctx = contexts[0];
    if (ctx) {
      debugLog(' Sending model context to HeadlessEmbed:', ctx.name);
      iframeRef.current.contentWindow.postMessage({
        type: 'set_model_context',
        modelContext: serializeModelContext(ctx),
      }, baseUrl);
    }
  }, [baseUrl, serializeModelContext]);
  
  // Send tool notification to a SPECIFIC MCP App by ID
  // If app not registered yet, queue the notification for replay when it registers
  const sendToolNotificationToApp = useCallback((appId: string, method: string, params: any) => {
    console.log(`[BotDojoChatProvider] Sending tool notification to app ${appId}: ${method}`, params);
    const sender = toolNotificationSendersRef.current.get(appId);
    if (sender) {
      try {
        sender(method, params);
      } catch (err) {
        console.warn(`[BotDojoChatProvider] Failed to send notification to ${appId}:`, err);
      }
    } else {
      // Queue notification for replay when app registers
      console.log(`[BotDojoChatProvider] App ${appId} not registered yet, queueing notification: ${method}`);
      if (!pendingToolNotificationsRef.current.has(appId)) {
        pendingToolNotificationsRef.current.set(appId, []);
      }
      pendingToolNotificationsRef.current.get(appId)!.push({ method, params });
    }
  }, []);
  
  // Broadcast tool notifications to all registered MCP App iframes
  // If no apps registered, queue for replay when any app registers
  const broadcastToolNotification = useCallback((method: string, params: any, toolName?: string) => {
    console.log(`[BotDojoChatProvider] Broadcasting tool notification: ${method}`, params);
    if (toolNotificationSendersRef.current.size === 0) {
      // No apps registered yet - queue for replay
      console.log(`[BotDojoChatProvider] No apps registered, queueing broadcast notification: ${method}`);
      pendingBroadcastNotificationsRef.current.push({ method, params, toolName: toolName || params?.tool?.name || '' });
    } else {
      toolNotificationSendersRef.current.forEach((sender, appId) => {
        try {
          sender(method, params);
        } catch (err) {
          console.warn(`[BotDojoChatProvider] Failed to send notification to ${appId}:`, err);
        }
      });
    }
  }, []);
  
  // Register a notification sender for an MCP App (called by McpAppHost)
  // Replays any queued notifications that were sent before registration
  const registerToolNotificationSender = useCallback((appId: string, sender: (method: string, params: any) => void) => {
    console.log(`[BotDojoChatProvider] Registering tool notification sender for: ${appId}`);
    toolNotificationSendersRef.current.set(appId, sender);
    
    // Replay any pending notifications for this specific app
    const pendingForApp = pendingToolNotificationsRef.current.get(appId);
    if (pendingForApp && pendingForApp.length > 0) {
      console.log(`[BotDojoChatProvider] Replaying ${pendingForApp.length} queued notifications for app: ${appId}`);
      pendingForApp.forEach(({ method, params }) => {
        try {
          console.log(`[BotDojoChatProvider] Replaying: ${method}`, params);
          sender(method, params);
        } catch (err) {
          console.warn(`[BotDojoChatProvider] Failed to replay notification to ${appId}:`, err);
        }
      });
      pendingToolNotificationsRef.current.delete(appId);
    }
    
    // Also replay any broadcast notifications that were queued
    // These are notifications that were sent before ANY app was registered
    const pendingBroadcasts = pendingBroadcastNotificationsRef.current;
    if (pendingBroadcasts.length > 0) {
      console.log(`[BotDojoChatProvider] Replaying ${pendingBroadcasts.length} queued broadcast notifications to: ${appId}`);
      // Send to this newly registered app
      pendingBroadcasts.forEach(({ method, params }) => {
        try {
          console.log(`[BotDojoChatProvider] Replaying broadcast: ${method}`, params);
          sender(method, params);
        } catch (err) {
          console.warn(`[BotDojoChatProvider] Failed to replay broadcast notification to ${appId}:`, err);
        }
      });
      // Clear broadcast queue after first app registers (they've been delivered)
      pendingBroadcastNotificationsRef.current = [];
    }
    
    return () => {
      console.log(`[BotDojoChatProvider] Unregistering tool notification sender for: ${appId}`);
      toolNotificationSendersRef.current.delete(appId);
    };
  }, []);
  
  // Register step update callback for an MCP App (used by McpAppHost to receive targeted updates)
  // Replays any queued step updates that arrived before the callback was registered
  const registerStepUpdateCallback = useCallback((appId: string, callback: (stepUpdate: any) => void) => {
    console.log(`[BotDojoChatProvider] Registering step update callback for app: ${appId}`);
    stepUpdateCallbacksRef.current.set(appId, callback);
    
    // Replay any pending step updates for this app
    const pendingUpdates = pendingStepUpdatesRef.current.get(appId);
    if (pendingUpdates && pendingUpdates.length > 0) {
      console.log(`[BotDojoChatProvider] Replaying ${pendingUpdates.length} queued step updates for app: ${appId}`);
      pendingUpdates.forEach((stepUpdate) => {
        try {
          console.log(`[BotDojoChatProvider] Replaying step update:`, stepUpdate.stepId);
          callback(stepUpdate);
        } catch (err) {
          console.warn(`[BotDojoChatProvider] Failed to replay step update to ${appId}:`, err);
        }
      });
      pendingStepUpdatesRef.current.delete(appId);
    }
    
    return () => {
      console.log(`[BotDojoChatProvider] Unregistering step update callback for app: ${appId}`);
      stepUpdateCallbacksRef.current.delete(appId);
    };
  }, []);
  
  // Send step update to a specific MCP App via its registered callback
  const sendStepUpdateToApp = useCallback((appId: string, stepUpdate: any) => {
    const callback = stepUpdateCallbacksRef.current.get(appId);
    if (callback) {
      console.log(`[BotDojoChatProvider] Sending step update to app: ${appId}`, stepUpdate);
      callback(stepUpdate);
    } else {
      console.warn(`[BotDojoChatProvider] No step update callback registered for app: ${appId}`);
    }
  }, []);
  
  // Execute a tool call from model context
  // targetAppId: if provided, notifications go to that specific MCP App only
  // If not provided, we look up the active app for this tool from step_update registrations
  const executeToolCall = useCallback(async (toolName: string, args: any, targetAppId?: string): Promise<any> => {
    const ctx = modelContextRef.current;
    if (!ctx) {
      throw new Error('No model context available');
    }
    
    const contexts = Array.isArray(ctx) ? ctx : [ctx];
    
    for (const context of contexts) {
      if (context.tools) {
        const toolsArray = Array.isArray(context.tools) ? context.tools : Object.values(context.tools);
        const tool = toolsArray.find((t: any) => t.name === toolName);
        if (tool && typeof tool.execute === 'function') {
          // Determine target MCP App:
          // 1. Use explicitly provided targetAppId
          // 2. Or look up the active app for this tool (registered from step_update)
          // 3. Or fallback to broadcast (last resort)
          let resolvedAppId = targetAppId;
          if (!resolvedAppId) {
            // Look up by full tool name first
            resolvedAppId = activeAppByToolRef.current.get(toolName);
            // Also try with context prefix (e.g., "headless_mcp_demo_show_remote_url_app")
            if (!resolvedAppId && context.name) {
              const prefixedToolName = `${context.name}_${toolName}`;
              resolvedAppId = activeAppByToolRef.current.get(prefixedToolName);
            }
          }
          
          console.log(`[BotDojoChatProvider] Executing tool "${toolName}" for app: ${resolvedAppId || 'ALL (broadcast)'}`);
          
          // Cache the tool arguments for hydration during step_update
          // Key by both toolName and appId (if known) for flexible lookup
          toolArgumentsCacheRef.current.set(toolName, args);
          if (resolvedAppId) {
            toolArgumentsCacheRef.current.set(resolvedAppId, args);
          }
          
          // Create execution context with notification callbacks
          // Use step update callback (registered by McpAppCanvas) to send notifications
          const executionContext: ToolExecutionContext = {
            toolName,
            notifyToolInputPartial: async (data: any) => {
              console.log(`[BotDojoChatProvider] Tool "${toolName}" notifyToolInputPartial:`, data);
              
              // Check if this is a progress update (not argument update)
              // Progress updates use kind: 'botdojo-tool-progress' and go to stepToolProgress
              const isProgressUpdate = data?.kind === 'botdojo-tool-progress';
              
              // Send via step update callback (McpAppCanvas registers this way)
              // Format as step update with arguments that McpAppCanvas can parse
              const stepUpdate = {
                stepToolName: toolName,
                toolName: toolName,
                // Only set stepToolArguments if NOT a progress update
                stepToolArguments: isProgressUpdate ? undefined : data,
                arguments: isProgressUpdate ? undefined : data,
                // Set stepToolProgress for progress updates
                stepToolProgress: isProgressUpdate ? data : undefined,
                stepStatus: 'processing',
              };
              
              if (resolvedAppId) {
                const callback = stepUpdateCallbacksRef.current.get(resolvedAppId);
                if (callback) {
                  console.log(`[BotDojoChatProvider] Sending partial update via step callback to: ${resolvedAppId}`);
                  callback(stepUpdate);
                } else {
                  // Queue for replay when callback is registered
                  console.log(`[BotDojoChatProvider] Callback not registered for ${resolvedAppId}, queueing`);
                  if (!pendingStepUpdatesRef.current.has(resolvedAppId)) {
                    pendingStepUpdatesRef.current.set(resolvedAppId, []);
                  }
                  pendingStepUpdatesRef.current.get(resolvedAppId)!.push(stepUpdate);
                }
              } else {
                // Broadcast to all registered callbacks
                console.log(`[BotDojoChatProvider] Broadcasting partial update to all apps`);
                stepUpdateCallbacksRef.current.forEach((callback, appId) => {
                  console.log(`[BotDojoChatProvider] Sending to: ${appId}`);
                  callback(stepUpdate);
                });
              }
            },
            notifyToolResult: async (data: any) => {
              console.log(`[BotDojoChatProvider] Tool "${toolName}" notifyToolResult:`, data);
              
              // Send via step update callback
              const stepUpdate = {
                stepToolName: toolName,
                toolName: toolName,
                stepToolResult: data?.result ?? data,
                result: data?.result ?? data,
                stepStatus: 'complete',
              };
              
              if (resolvedAppId) {
                const callback = stepUpdateCallbacksRef.current.get(resolvedAppId);
                if (callback) {
                  console.log(`[BotDojoChatProvider] Sending result via step callback to: ${resolvedAppId}`);
                  callback(stepUpdate);
                } else {
                  console.log(`[BotDojoChatProvider] Callback not registered for ${resolvedAppId}, queueing result`);
                  if (!pendingStepUpdatesRef.current.has(resolvedAppId)) {
                    pendingStepUpdatesRef.current.set(resolvedAppId, []);
                  }
                  pendingStepUpdatesRef.current.get(resolvedAppId)!.push(stepUpdate);
                }
              } else {
                // Broadcast to all registered callbacks
                console.log(`[BotDojoChatProvider] Broadcasting result to all apps`);
                stepUpdateCallbacksRef.current.forEach((callback, appId) => {
                  console.log(`[BotDojoChatProvider] Sending result to: ${appId}`);
                  callback(stepUpdate);
                });
              }
            },
          };
          
          // Execute the tool
          const result = await tool.execute(args, executionContext);
          
          // Automatically send the result to the MCP App widget
          // This ensures tool.result is populated in useMcpApp hook
          if (result !== undefined) {
            await executionContext.notifyToolResult(result);
          }
          
          return result;
        }
      }
    }
    
    throw new Error(`Tool not found: ${toolName}`);
  }, []);
  
  /**
   * Get MCP App data by ID.
   * McpAppHost calls this to get URL, arguments, result, etc.
   * 
   * Lookup order:
   * 1. Check mcpAppDataCache (populated during streaming with resolved data)
   * 2. Search state.messages for step with matching canvasId (hydration path)
   * 
   * This ensures both streaming and hydration work correctly.
   */
  const getMcpAppData = useCallback((appId: string) => {
    // 1. Check cache first (populated during streaming)
    const cached = mcpAppDataCacheRef.current.get(appId);
    if (cached?.url) {
      return { mcpAppId: appId, mcpAppType: 'mcp-app' as const, ...cached };
    }
    
    // 2. Search state.messages for step with matching canvasId (hydration path)
    for (const msg of state.messages) {
      for (const step of msg.steps || []) {
        if (step.canvas?.canvasId === appId) {
          // Build proxy URL for ui:// resources during hydration
          const canvasUrl = step.canvas.canvasData?.url;
          let proxyUrl: string | undefined;
          if (canvasUrl?.startsWith('ui://')) {
            const flowId = cacheKey || appId;
            
            // Check if tool has botdojo/no-cache in _meta
            let noCache = false;
            const toolName = step.stepToolName;
            debugLog(' Checking no-cache for tool:', toolName, 'modelContextRef:', !!modelContextRef.current);
            if (toolName && modelContextRef.current) {
              const contexts = Array.isArray(modelContextRef.current) ? modelContextRef.current : [modelContextRef.current];
              for (const ctx of contexts) {
                const tools = ctx.tools;
                debugLog(' Context tools:', Array.isArray(tools) ? tools.length : 'not array');
                if (Array.isArray(tools)) {
                  const tool = tools.find((t: any) => t.name === toolName);
                  debugLog(' Found tool:', tool?.name, '_meta:', tool?._meta);
                  if (tool?._meta?.['botdojo/no-cache']) {
                    noCache = true;
                    break;
                  }
                }
              }
            }
            debugLog(' noCache result:', noCache);
            
            try {
              proxyUrl = buildMcpProxyUrl({ flowId: String(flowId), resource: canvasUrl, noCache });
            } catch (err) {
              console.warn('[BotDojoChatProvider] Failed to build proxy URL for hydration:', err);
            }
          }
          
          return {
            mcpAppId: appId,
            mcpAppType: 'mcp-app' as const,
            url: proxyUrl || canvasUrl,  // Proxy URL for ui://, direct URL otherwise
            toolInfo: step.stepToolName ? { tool: { name: step.stepToolName } } : undefined,
            arguments: step.stepToolArguments,
            result: step.stepToolResult,
            height: step.canvas.canvasData?.height,
            width: step.canvas.canvasData?.width,
            ...cached,  // Merge any partial cached data
          };
        }
      }
    }
    
    // Return cached data even without URL (may have partial data)
    return cached ? { mcpAppId: appId, mcpAppType: 'mcp-app' as const, ...cached } : null;
  }, [state.messages]);
  
  /**
   * Update cached MCP App data (merges with existing)
   * Increments version counter to trigger re-renders of components reading from cache
   */
  const updateMcpAppDataCache = useCallback((appId: string, data: Partial<{
    html?: string;
    url?: string;
    arguments?: any;
    result?: any;
    isComplete?: boolean;
    toolInfo?: { tool: { name: string } };
    height?: string;
    width?: string;
    state?: any;
  }>) => {
    const existing = mcpAppDataCacheRef.current.get(appId) || {};
    mcpAppDataCacheRef.current.set(appId, { ...existing, ...data });
    // Trigger re-render of components that depend on MCP App data
    setMcpAppDataVersion(v => v + 1);
  }, []);

  // Get resource from model context
  const getResource = useCallback(async (uri: string, params?: any, onlyMetadata?: boolean): Promise<any> => {
    debugLog(' getResource called for URI:', uri);
    const ctx = modelContextRef.current;
    if (!ctx) {
      console.error('[BotDojoChatProvider] getResource: No model context available');
      throw new Error('No model context available');
    }
    
    const contexts = Array.isArray(ctx) ? ctx : [ctx];
    debugLog(' getResource: Searching', contexts.length, 'context(s)');
    
    for (const context of contexts) {
      if (context.resources) {
        debugLog(' getResource: Context has', context.resources.length, 'resources');
        for (const resource of context.resources) {
          const resourceUri = 'uri' in resource ? resource.uri : 'no-uri';
          debugLog(' getResource: Checking resource URI:', resourceUri, '=== requested URI:', uri, '?', resourceUri === uri);
          // Check for exact URI match
          if ('uri' in resource && resource.uri === uri && resource.getContent) {
            debugLog(' getResource: MATCH FOUND! Calling getContent()');
            const content = await resource.getContent();
            debugLog(' getResource: getContent returned:', typeof content, typeof content === 'object' && content && 'uri' in content ? content.uri : '(no uri)');
            return {
              uri,
              mimeType: resource.mimeType,
              ...(typeof content === 'string' ? { text: content } : content)
            };
          }
        }
      }
    }
    
    console.error('[BotDojoChatProvider] getResource: Resource not found:', uri);
    throw new Error(`Resource not found: ${uri}`);
  }, []);

  // Register an MCP App iframe and set up its bridge
  const registerMcpApp = useCallback((appId: string, iframeWindow: Window) => {
    debugLog(' Registering MCP App iframe:', appId);
    
    // If this appId was already registered (e.g., React Strict Mode double mount),
    // tear down the old bridge and replace it with the new iframe window.
    if (appBridgesRef.current.has(appId)) {
      debugLog(' MCP App already registered, refreshing bridge:', appId);
      const existingBridge = appBridgesRef.current.get(appId);
      existingBridge?.stop();
      appBridgesRef.current.delete(appId);
    }

    // Store iframe window reference
    appIframeRefsRef.current.set(appId, iframeWindow);

    // Create PostMessageBridge for this app
    const bridge = new PostMessageBridge({
      targetWindow: iframeWindow,
      targetOrigin: baseUrl,
      clientId: `parent-to-app-${appId}`,
      debug: true,
      role: 'parent',
      onMessage: async (msg: RPCMessage) => {
        debugLog(' Message from MCP App:', appId, msg.functionName);
        
        // Handle tool calls from app
        if (msg.functionName.startsWith('tool_')) {
          const toolName = msg.functionName.substring(5); // Remove 'tool_' prefix
          
          // Check if tool exists on parent connector
          if (connectorRef.current) {
            // TODO: Execute tool via connector
            debugLog(' Tool call from app:', toolName, msg.data);
          } else {
            // Forward to server via headless embed iframe
            debugLog(' Forwarding tool call to server:', toolName);
            if (iframeRef.current?.contentWindow) {
              iframeRef.current.contentWindow.postMessage(
                {
                  type: 'tool_call',
                  appId,
                  toolName,
                  data: msg.data,
                },
                baseUrl
              );
            }
          }
        }
      },
      onError: (error) => {
        console.error('[BotDojoChatProvider] MCP App bridge error:', appId, error);
      }
    });

    // Start the bridge
    bridge.start();

    // Store bridge
    appBridgesRef.current.set(appId, bridge);
    
    // Update registered apps set
    setRegisteredMcpApps(prev => new Set(prev).add(appId));

    // Send any pending events
    const pending = pendingAppEventsRef.current.get(appId);
    if (pending && pending.length > 0) {
      debugLog(' Sending pending events to app:', appId, pending.length);
      pending.forEach(event => {
        bridge.sendMessage(RPCMessage.request(
          `parent-to-app-${appId}`,
          'app',
          event.eventName,
          event.data
        ));
      });
      pendingAppEventsRef.current.delete(appId);
    }

    debugLog(' MCP App registered successfully:', appId);
  }, [baseUrl]);

  // Unregister an MCP App iframe
  const unregisterMcpApp = useCallback((appId: string) => {
    debugLog(' Unregistering MCP App iframe:', appId);
    
    const bridge = appBridgesRef.current.get(appId);
    if (bridge) {
      bridge.stop();
      appBridgesRef.current.delete(appId);
    }
    
    appIframeRefsRef.current.delete(appId);
    pendingAppEventsRef.current.delete(appId);
    
    setRegisteredMcpApps(prev => {
      const next = new Set(prev);
      next.delete(appId);
      return next;
    });
  }, []);

  // Forward events to specific MCP App iframe
  const forwardEventToApp = useCallback((appId: string, eventName: string, data: any) => {
    const bridge = appBridgesRef.current.get(appId);
    if (bridge) {
      debugLog(' Forwarding event to app:', appId, eventName);
      bridge.sendMessage(RPCMessage.request(
        `parent-to-app-${appId}`,
        'app',
        eventName,
        data
      ));
    } else {
      // Queue event if app not ready yet
      debugLog(' Queueing event for app (not ready):', appId, eventName);
      if (!pendingAppEventsRef.current.has(appId)) {
        pendingAppEventsRef.current.set(appId, []);
      }
      pendingAppEventsRef.current.get(appId)!.push({ eventName, data });
    }
  }, []);

  // Note: RPCConnection is no longer used.
  // Model context registration and tool call routing is handled by the MCP App Host iframe
  // which connects via Socket.IO to the server.

  // Handle incoming messages from iframes (headless and MCP host)
  const handleMessage = useCallback((event: MessageEvent) => {
    // Verify origin for security
    try {
      const eventOrigin = new URL(event.origin).origin;
      const expectedOrigin = new URL(baseUrl).origin;
      if (eventOrigin !== expectedOrigin) {
        return;
      }
    } catch (e) {
      console.error('[BotDojoChatProvider] Invalid origin:', event.origin);
      return;
    }

    // Parse event data
    const data = event.data as HeadlessEvent | any;
    if (!data || !data.type) return;

    // Let PostMessageBridge handle RPC messages
    if (data.type?.startsWith('botdojo-')) {
      return; // PostMessageBridge will handle this
    }

    debugLog(' Received event:', data.type, data);

    // Map iframe events to reducer actions
    switch (data.type) {
      // === HeadlessEmbed Socket.IO Events ===
      case 'socket_connected':
        debugLog(' HeadlessEmbed Socket.IO connected');
        setIsSocketConnected(true);
        // Send model context now that Socket.IO is connected
        sendModelContextToHeadless();
        break;
        
      case 'request_model_context':
        // HeadlessEmbed is requesting model context for Socket.IO registration
        debugLog(' HeadlessEmbed requesting model context');
        sendModelContextToHeadless();
        break;
        
      case 'get_model_contexts':
        // HeadlessEmbed is requesting all model contexts
        debugLog(' HeadlessEmbed requesting all model contexts');
        sendModelContextToHeadless();
        break;
        
      case 'tool_call':
        // HeadlessEmbed received a tool call from the agent via Socket.IO
        // data.appId: if present, notifications go to that specific MCP App only
        debugLog(' Tool call from HeadlessEmbed:', data.toolName, 'appId:', data.appId || data.canvasId || 'none');
        (async () => {
          try {
            const result = await executeToolCall(data.toolName, data.arguments, data.appId || data.canvasId);
            console.log(`[BotDojoChatProvider] ✅ Tool "${data.toolName}" executed successfully`);
            // Send response back to HeadlessEmbed
            iframeRef.current?.contentWindow?.postMessage({
              type: 'tool_response',
              requestId: data.requestId,
              result,
            }, baseUrl);
          } catch (error: any) {
            console.error(`[BotDojoChatProvider] ❌ Tool "${data.toolName}" failed:`, error);
            iframeRef.current?.contentWindow?.postMessage({
              type: 'tool_response',
              requestId: data.requestId,
              error: error.message,
            }, baseUrl);
          }
        })();
        break;
        
      case 'get_resource':
        // HeadlessEmbed is requesting a resource
        debugLog(' Resource request from HeadlessEmbed:', data.uri);
        (async () => {
          try {
            const resource = await getResource(data.uri, data.params, data.onlyMetadata);
            iframeRef.current?.contentWindow?.postMessage({
              type: 'get_resource_response',
              requestId: data.requestId,
              resource,
            }, baseUrl);
          } catch (error: any) {
            console.error(`[BotDojoChatProvider] ❌ Resource fetch failed:`, error);
            iframeRef.current?.contentWindow?.postMessage({
              type: 'get_resource_response',
              requestId: data.requestId,
              error: error.message,
            }, baseUrl);
          }
        })();
        break;
        
      case 'model_context_registered':
        debugLog(' ✅ Model context registered:', data.name);
        setIsModelContextRegistered(true);
        onConnectorInit?.(null); // Notify that "connector" is ready (deprecated, headless mode doesn't use connector)
        break;
        
      case 'model_context_registration_error':
        console.error('[BotDojoChatProvider] ❌ Model context registration failed:', data.error);
        onConnectorError?.(new Error(data.error));
        break;
        
      case 'socket_error':
        console.error('[BotDojoChatProvider] HeadlessEmbed Socket.IO error:', data.error);
        onConnectorError?.(new Error(data.error));
        break;
      
      // === Headless Iframe Events ===
      case 'ready':
        dispatch({ type: 'READY' });
        onReady?.();
        break;
      
      case 'session_created':
        // Session has been created or loaded
        if (data.sessionId) {
          dispatch({ type: 'SET_SESSION', sessionId: data.sessionId });
          onSessionCreated?.(data.sessionId);
        }
        break;
      
      case 'session_hydrated':
        // Session history has been loaded
        if (onSessionHydrated && typeof data.messageCount === 'number') {
          onSessionHydrated(data.messageCount);
        }
        break;

      case 'error':
        const error = new Error(data.error);
        dispatch({ type: 'ERROR', error });
        onError?.(error);
        break;

      case 'message_start':
        dispatch({
          type: 'MESSAGE_START',
          messageId: data.messageId,
          role: data.role,
        });
        break;

      case 'message_complete':
        dispatch({
          type: 'MESSAGE_COMPLETE',
          messageId: data.messageId,
          content: data.content,
        });
        break;

      case 'step_update':
    
        // Cast to RawServerStep to access both SDK and raw server properties
        const rawStep = data.step as RawServerStep;
        
        // Debug: Log MCP App info in step
        if (rawStep?.canvas) {
          debugLog(' Step has MCP App:', rawStep.canvas.canvasId, rawStep.canvas.canvasType, JSON.stringify(rawStep.canvas.canvasData, null, 2));
          
          // Register this app as the active app for its tool
          // This allows executeToolCall to route notifications to the correct app
          // Use stepToolName if available, otherwise fall back to stepLabel (display name)
          const toolName = rawStep.stepToolName || rawStep.stepLabel;
          const appId = rawStep.canvas.canvasId;
          if (toolName && appId) {
            console.log(`[BotDojoChatProvider] Registering app ${appId} for tool: ${toolName}`);
            activeAppByToolRef.current.set(toolName, appId);
          }
          // Also register stepId → appId so we can forward step updates without canvas
          if (rawStep.stepId && appId) {
            stepIdToAppIdRef.current.set(rawStep.stepId, appId);
          }
        }
        
        // Handle steps with canvas that have ui:// URLs - resolve to HTML
        (async () => {
          let stepToDispatch: RawServerStep = rawStep;
          
          // Check if canvas URL is a custom ui:// URI that needs to be resolved
          const canvasUrl = rawStep?.canvas?.canvasData?.url;
          if (canvasUrl && canvasUrl.startsWith('ui://') && !rawStep?.canvas?.canvasData?.html) {
            debugLog(' Resolving ui:// resource:', canvasUrl);
            try {
              const resource = await getResource(canvasUrl);
              debugLog(' Resource result:', resource ? 'got content' : 'no content');
              // getResource returns { text: content } for string content
              let htmlContent = resource?.text || resource?.content;
              if (htmlContent) {
                // Extract CSP from resource metadata and inject into HTML
                const cspMeta = extractUiCspFromResource(resource);
                if (cspMeta) {
                  const resolvedCsp = resolveUiCsp(cspMeta);
                  debugLog(' Injecting CSP into HTML:', resolvedCsp.csp.substring(0, 100) + '...');
                  // Inject CSP meta tag into HTML head
                  const cspMetaTag = `<meta http-equiv="Content-Security-Policy" content="${resolvedCsp.csp.replace(/"/g, '&quot;')}">`;
                  if (/<head[^>]*>/i.test(htmlContent)) {
                    htmlContent = htmlContent.replace(/<head([^>]*)>/i, `<head$1>\n${cspMetaTag}\n`);
                  } else if (/<html[^>]*>/i.test(htmlContent)) {
                    htmlContent = htmlContent.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${cspMetaTag}\n</head>`);
                  } else {
                    htmlContent = `<head>\n${cspMetaTag}\n</head>\n${htmlContent}`;
                  }
                }
                // Update the step with resolved HTML
                stepToDispatch = {
                  ...rawStep,
                  canvas: {
                    ...rawStep.canvas,
                    canvasData: {
                      ...rawStep.canvas.canvasData,
                      html: htmlContent,
                    },
                  },
                };
                debugLog(' ✅ Resolved ui:// resource to HTML (' + htmlContent.length + ' chars)');
                
                // Always build proxy URL for ui:// resources (per MCP spec, blob URLs not supported)
                let proxyUrl: string | undefined;
                const proxyOrigin = process.env.NEXT_PUBLIC_MCP_HTML_PROXY_ORIGIN || undefined;
                const canvasId = rawStep.canvas?.canvasId;
                const flowIdForProxy = cacheKey || canvasId || `unknown-${generateUUID()}`;
                
                // Check if tool has botdojo/no-cache in _meta to disable proxy caching
                let noCache = false;
                const toolNameForMeta = rawStep.stepToolName || rawStep.stepLabel;
                debugLog(' handleStepUpdate - Checking no-cache for tool:', toolNameForMeta, 'modelContextRef:', !!modelContextRef.current);
                if (toolNameForMeta && modelContextRef.current) {
                  const contexts = Array.isArray(modelContextRef.current) ? modelContextRef.current : [modelContextRef.current];
                  for (const ctx of contexts) {
                    const tools = ctx.tools;
                    debugLog(' handleStepUpdate - Context tools:', Array.isArray(tools) ? tools.length : 'not array');
                    if (Array.isArray(tools)) {
                      const tool = tools.find((t: any) => t.name === toolNameForMeta);
                      debugLog(' handleStepUpdate - Found tool:', tool?.name, '_meta:', JSON.stringify(tool?._meta));
                      if (tool?._meta?.['botdojo/no-cache']) {
                        noCache = true;
                        break;
                      }
                    }
                  }
                }
                debugLog(' handleStepUpdate - noCache result:', noCache);
                
                try {
                  proxyUrl = buildMcpProxyUrl({
                    flowId: String(flowIdForProxy),
                    resource: canvasUrl,
                    ...(proxyOrigin ? { origin: proxyOrigin } : {}),
                    noCache,
                  });
                  debugLog(' Using MCP proxy URL:', proxyUrl, noCache ? '(no-cache)' : '');
                } catch (err) {
                  console.warn('[BotDojoChatProvider] Failed to build MCP proxy URL', err);
                }
                
                // Cache the HTML for this appId so McpAppHost can get it later
                const appIdForCache = rawStep.canvas.canvasId;
                if (appIdForCache) {
                  const toolNameForCache = rawStep.stepToolName || rawStep.stepLabel;
                  updateMcpAppDataCache(appIdForCache, {
                    html: htmlContent,
                    url: proxyUrl || canvasUrl,
                    toolInfo: toolNameForCache ? { tool: { name: toolNameForCache } } : undefined,
                    height: rawStep.canvas.canvasData?.height,
                    width: rawStep.canvas.canvasData?.width,
                  });
                }
              } else {
                console.warn('[BotDojoChatProvider] ⚠️ Resource resolved but no text/content found:', Object.keys(resource || {}));
              }
            } catch (err: unknown) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              console.error('[BotDojoChatProvider] ❌ Failed to resolve ui:// resource:', errorMessage);
            }
          }
          
       
          
          dispatch({
            type: 'STEP_UPDATE',
            messageId: data.messageId,
            step: stepToDispatch,
          });
          
          // Forward step updates to relevant MCP App via registered callback (preferred)
          // This sends directly to the specific app without broadcasting
          // Look up appId from: canvas.canvasId OR stepId → appId mapping OR toolName → appId mapping
          const appIdFromCanvas = stepToDispatch?.canvas?.canvasId;
          const appIdFromStepId = stepToDispatch?.stepId ? stepIdToAppIdRef.current.get(stepToDispatch.stepId) : undefined;
          const toolNameForLookup = stepToDispatch?.stepToolName || stepToDispatch?.stepLabel;
          const appIdFromToolName = toolNameForLookup ? activeAppByToolRef.current.get(toolNameForLookup) : undefined;
          const appId = appIdFromCanvas || appIdFromStepId || appIdFromToolName;
          
          if (appId) {
            
            // Prepare enriched step update with parsed tool data
            const toolName = stepToDispatch.stepToolName || stepToDispatch.stepLabel;
            
            // Helper to parse JSON strings into objects
            const parseIfJson = (value: any): any => {
              if (value === undefined || value === null || value === '') return undefined;
              if (typeof value === 'object') return value;
              if (typeof value === 'string' && value.trim()) {
                try {
                  return JSON.parse(value);
                } catch {
                  return value; // Return as-is if not valid JSON
                }
              }
              return value;
            };
            
            // Get tool result - treat empty strings as missing (server may send "" during streaming)
            // Parse JSON strings since server often sends results as JSON strings in 'content'
            const canvasResult = parseIfJson(stepToDispatch?.canvas?.canvasData?.result);
            const rawStepResult = stepToDispatch.stepToolResult;
            const stepResult = (rawStepResult !== undefined && rawStepResult !== '')
              ? parseIfJson(rawStepResult)
              : (canvasResult !== undefined ? canvasResult : parseIfJson(stepToDispatch.content));
            
            // Get tool arguments from step properties, parse from raw 'arguments' string, or fall back to cache
            // Server sends 'arguments' as a JSON string, we need to parse it
            const rawStepArgs = stepToDispatch.stepToolArguments;
            const rawArgsString = stepToDispatch.arguments;
            const canvasArgs = stepToDispatch?.canvas?.canvasData?.arguments;
            let stepArguments: Record<string, unknown> | null = (rawStepArgs && typeof rawStepArgs === 'object')
              ? rawStepArgs
              : null;
            
            // Parse arguments string if stepToolArguments not available
            if (!stepArguments && rawArgsString && rawArgsString.trim()) {
              try {
                stepArguments = JSON.parse(rawArgsString);
              } catch {
                // Arguments may be partial/invalid JSON during streaming - ignore parse errors
              }
            }

            // Parse arguments provided via canvasData (some servers attach args there)
            if (!stepArguments && canvasArgs !== undefined) {
              if (typeof canvasArgs === 'object') {
                stepArguments = canvasArgs as Record<string, unknown>;
              } else if (typeof canvasArgs === 'string' && canvasArgs.trim()) {
                try {
                  stepArguments = JSON.parse(canvasArgs);
                } catch {
                  // Ignore parse errors for partial/invalid JSON during streaming
                }
              }
            }
            
            // Fall back to cache if still no arguments
            if (!stepArguments) {
              stepArguments = toolArgumentsCacheRef.current.get(appId)
                || (toolName ? toolArgumentsCacheRef.current.get(toolName) : null)
                || null;
            }
            
            // Build enriched step update
            const enrichedStepUpdate = {
              ...stepToDispatch,
              stepToolName: toolName,
              stepToolArguments: stepArguments ?? undefined,
              stepToolResult: stepResult,
            };
            
            // Update the MCP App data cache with arguments and result
            // This persists the data so McpAppHost can get it even after step completes
            updateMcpAppDataCache(appId, {
              ...(stepArguments ? { arguments: stepArguments } : {}),
              ...(stepResult !== undefined ? { result: stepResult } : {}),
              ...(stepToDispatch.stepStatus === 'complete' ? { isComplete: true } : {}),
              ...(toolName ? { toolInfo: { tool: { name: toolName } } } : {}),
            });

            // First try the step update callback (new approach - sends to specific app)
            const callback = stepUpdateCallbacksRef.current.get(appId);
            if (callback) {
              console.log(`[BotDojoChatProvider] Sending step update via callback to app: ${appId}`, {
                hasStepToolResult: stepResult !== undefined,
                hasStepContent: stepToDispatch.content !== undefined,
                hasCachedArgs: !!stepArguments,
                hasCanvasArgs: canvasArgs !== undefined,
                hasCanvasResult: canvasResult !== undefined && canvasResult !== '',
                toolName,
                rawStepResult,
                rawStepArgs,
                canvasResult,
              });
              callback(enrichedStepUpdate);
            } else {
              // McpAppHost not mounted yet - queue the step update for replay
              console.log(`[BotDojoChatProvider] Callback not registered for ${appId}, queueing step update`);
              if (!pendingStepUpdatesRef.current.has(appId)) {
                pendingStepUpdatesRef.current.set(appId, []);
              }
              pendingStepUpdatesRef.current.get(appId)!.push(enrichedStepUpdate);
              
              // Also try legacy approach as fallback
              forwardEventToApp(
                appId,
                'onIntermediateStepUpdate',
                stepToDispatch
              );
            }
          }
        })();
        break;

      case 'token':
        dispatch({
          type: 'TOKEN',
          messageId: data.messageId,
          tokenUpdate: data.tokenUpdate,
        });
        break;

      case 'request_aborted':
        dispatch({ type: 'REQUEST_ABORTED' });
        break;

      default:
        // Don't warn for unknown types - there may be other messages we don't need to handle
        break;
    }
  }, [baseUrl, onReady, onError, onConnectorInit, onConnectorError, onSessionCreated, onSessionHydrated, forwardEventToApp, sendModelContextToHeadless, executeToolCall, getResource]);

  // Set up message listener
  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Context value with connector, connection, and MCP App methods
  const contextValue: BotDojoChatContextType = useMemo(
    () => ({
      state,
      dispatch,
      iframeRef,
      connector,
      connection: connectionRef.current,
      registerMcpApp,
      unregisterMcpApp,
      registeredMcpApps,
      registerToolNotificationSender,
      sendToolNotificationToApp,
      registerStepUpdateCallback,
      sendStepUpdateToApp,
      getMcpAppData,
      mcpAppDataVersion,
      getResource,
      appHandlers: appHandlersRef,
      debug,
    }),
    [state, connector, registerMcpApp, unregisterMcpApp, registeredMcpApps, registerToolNotificationSender, sendToolNotificationToApp, registerStepUpdateCallback, sendStepUpdateToApp, getMcpAppData, mcpAppDataVersion, getResource, debug]
  );

  return (
    <BotDojoChatContext.Provider value={contextValue}>
      {children}
      
      {/* Hidden iframe for headless chat communication
          HeadlessEmbed handles:
          - HTTP streaming (flow request channel) for tokens, steps, flow completion
          - Socket.IO (external UI channel) for model context registration and tool calls */}
      <iframe
        ref={iframeRef}
        src={iframeUrl}
        onLoad={handleIframeLoad}
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
          border: 'none',
          left: '-9999px',
        }}
        title="BotDojo Headless Chat"
      />
    </BotDojoChatContext.Provider>
  );
}
