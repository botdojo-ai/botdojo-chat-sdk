/**
 * McpAppHost Component
 * 
 * Hosts an MCP App in an iframe with full JSON-RPC communication.
 * Uses the shared useMcpHostBridge hook from sdk-canvas for all protocol handling.
 */

import React, { useEffect, useContext, useRef } from 'react';
import { useMcpHostBridge } from '../../hooks/useMcpHostBridge';
import { useMcpAppHost } from '../hooks/useMcpAppHost';
import { BotDojoChatContext } from '../context/BotDojoChatProvider';

/**
 * Props for McpAppHost component
 * 
 * MCP App data (HTML, arguments, result, etc.) is provided by BotDojoChatProvider
 * via context. Parents only need to pass the mcpAppId.
 */
export interface McpAppHostProps {
  /**
   * Unique identifier for this MCP App instance.
   * McpAppHost gets HTML, arguments, result from BotDojoChatProvider's cache.
   */
  mcpAppId: string;
  
  /**
   * Optional resource URI (e.g., ui://my-app/main) to resolve on demand.
   * Used for hydration when the cache doesn't have HTML yet.
   * If not provided, the component relies on cached data from streaming.
   */
  resourceUri?: string;
  
  /**
   * Called when app requests to open a link (ui/open-link)
   * Links are NOT automatically opened - host must handle this
   */
  onOpenLink?: (url: string, target: string, mcpAppId: string) => void;
  
  /**
   * Called when app requests a tool execution (tools/call)
   * Return value is sent back to the app as JSON-RPC response
   */
  onToolCall?: (tool: string, params: any, mcpAppId: string) => Promise<any>;
  
  /**
   * Called when app sends a UI message (ui/message)
   */
  onUiMessage?: (message: string, params: any, mcpAppId: string) => void;
  
  /**
   * Called when app wants to persist state
   */
  onPersistState?: (state: Record<string, any>, mcpAppId: string) => void;
  
  /**
   * Called when app reports a size change (ui/notifications/size-change)
   */
  onSizeChange?: (width: number, height: number, mcpAppId: string) => void;
  
  /**
   * Called when app is initialized and ready
   */
  onReady?: (mcpAppId: string) => void;
  
  /**
   * Width of the iframe
   * @default '100%'
   */
  width?: string | number;
  
  /**
   * Height of the iframe
   * @default '100%'
   */
  height?: string | number;
  
  /**
   * Additional styles for the iframe
   */
  style?: React.CSSProperties;
  
  /**
   * Additional host context to send to the app on initialization
   */
  initialHostContext?: Record<string, any>;
  
  /**
   * Enable debug logging
   */
  debug?: boolean;
}

/**
 * McpAppHost - Hosts an MCP App iframe with full event handling
 * 
 * All MCP App data (URL, arguments, result, etc.) is automatically provided
 * by BotDojoChatProvider via context. Parents only need to pass the mcpAppId.
 * 
 * When no valid URL is available:
 * - If debug=false (production): Returns null (no empty iframe)
 * - If debug=true: Shows error details to help developers diagnose issues
 * 
 * @example
 * ```tsx
 * // Simple usage - just pass the mcpAppId
 * <McpAppHost mcpAppId={step.canvas.canvasId} />
 * 
 * // With debug mode for development
 * <McpAppHost
 *   mcpAppId={step.canvas.canvasId}
 *   debug={true}
 *   onOpenLink={(url, target, appId) => window.open(url, target)}
 * />
 * ```
 */
export function McpAppHost(props: McpAppHostProps): JSX.Element | null {
  const {
    mcpAppId,
    resourceUri,
    onOpenLink,
    onToolCall,
    onUiMessage,
    onPersistState,
    onSizeChange,
    onReady,
    width = '100%',
    height = '100%',
    style,
    initialHostContext,
    debug: debugProp,
  } = props;

  const mcpAppHostContext = useMcpAppHost();
  const chatContext = useContext(BotDojoChatContext);
  const getResource = chatContext?.getResource;
  
  // Use debug from props, or fall back to context
  const debug = debugProp ?? chatContext?.debug ?? false;
  
  // Get MCP App data from BotDojoChatProvider's cache
  // mcpAppDataVersion triggers re-renders when cache is updated
  const _version = chatContext?.mcpAppDataVersion; // eslint-disable-line @typescript-eslint/no-unused-vars
  const mcpAppData = chatContext?.getMcpAppData?.(mcpAppId);
  
  if (debug) {
    console.log(`[McpAppHost:${mcpAppId}] Render - mcpAppData:`, {
      version: _version,
      hasHtml: !!mcpAppData?.html,
      hasUrl: !!mcpAppData?.url,
      hasChatContext: !!chatContext,
    });
  }

  // Only use url if it's a real HTTP(S) URL, not a ui:// resource URI
  const effectiveUrl = mcpAppData?.url?.startsWith('http') ? mcpAppData.url : undefined;
  
  // Use the shared hook for all iframe/protocol handling
  const {
    iframeRef,
    status,
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
  } = useMcpHostBridge({
    appId: mcpAppId,
    html: mcpAppData?.html,
    url: effectiveUrl,
    toolInfo: mcpAppData?.toolInfo,
    arguments: mcpAppData?.arguments,
    result: mcpAppData?.result,
    state: mcpAppData?.state,
    isComplete: mcpAppData?.isComplete,
    hostContext: initialHostContext,
    debug,
    
    // Wrap callbacks to include mcpAppId
    onOpenLink: (url, target) => {
      const handler = onOpenLink || mcpAppHostContext?.onOpenLink;
      handler?.(url, target, mcpAppId);
    },
    onToolCall: async (tool, params) => {
      const handler = onToolCall || mcpAppHostContext?.onToolCall;
      if (handler) {
        return handler(tool, params, mcpAppId);
      }
      return { ok: false, error: 'No tool handler' };
    },
    onMessage: (message, params) => {
      const handler = onUiMessage || mcpAppHostContext?.onUiMessage;
      handler?.(message, params, mcpAppId);
    },
    onPersistState: (state) => {
      const handler = onPersistState || mcpAppHostContext?.onPersistState;
      handler?.(state, mcpAppId);
    },
    onSizeChange: (w, h) => {
      onSizeChange?.(w, h, mcpAppId);
    },
    onReady: () => {
      onReady?.(mcpAppId);
    },
    
    // Handle sandbox-resource requests from proxy
    onSandboxResourceRequest: async ({ resource }) => {
      console.log(`[McpAppHost:${mcpAppId}] onSandboxResourceRequest for:`, resource);
      
      // 1. Check cached HTML first (from streaming)
      if (mcpAppData?.html) {
        console.log(`[McpAppHost:${mcpAppId}] Returning cached HTML, length:`, mcpAppData.html.length);
        return { html: mcpAppData.html };
      }
      
      // 2. Try to resolve the resource on demand (for hydration)
      // Use the resourceUri prop or the resource param from the request
      const uriToResolve = resourceUri || resource;
      if (uriToResolve && getResource) {
        console.log(`[McpAppHost:${mcpAppId}] Resolving resource on demand:`, uriToResolve);
        try {
          const resolved = await getResource(uriToResolve);
          const html = resolved?.text || resolved?.content || resolved?.html;
          if (html) {
            console.log(`[McpAppHost:${mcpAppId}] Resolved resource to HTML, length:`, html.length);
            return { html };
          }
        } catch (err) {
          console.error(`[McpAppHost:${mcpAppId}] Failed to resolve resource:`, err);
        }
      }
      
      console.log(`[McpAppHost:${mcpAppId}] No HTML available for resource`);
      return null;
    },
  });

  // Register with McpAppHostContext (for source -> appId mapping)
  useEffect(() => {
    if (mcpAppHostContext && iframeRef.current?.contentWindow) {
      mcpAppHostContext.registerApp(mcpAppId, iframeRef.current.contentWindow);
      return () => mcpAppHostContext.unregisterApp(mcpAppId);
    }
  }, [mcpAppId, mcpAppHostContext, iframeRef]);

  // Use ref for chatContext to avoid re-registering on every context change
  const chatContextRef = useRef(chatContext);
  chatContextRef.current = chatContext;
  
  // Register tool notification sender with BotDojoChatContext
  useEffect(() => {
    const ctx = chatContextRef.current;
    if (!ctx?.registerToolNotificationSender) return;
    
    const unregister = ctx.registerToolNotificationSender(mcpAppId, sendToolNotification);
    return unregister;
  }, [mcpAppId, sendToolNotification]);
  
  // Register step update callback with BotDojoChatContext
  useEffect(() => {
    const ctx = chatContextRef.current;
    if (!ctx?.registerStepUpdateCallback) return;
    
    const unregister = ctx.registerStepUpdateCallback(mcpAppId, sendStepUpdate);
    return unregister;
  }, [mcpAppId, sendStepUpdate]);

  // Use auto-height from ui/size-change if available
  const effectiveHeight = autoHeight ? `${autoHeight}px` : (mcpAppData?.height || height);

  // If can't render and not in debug mode, return null (no empty iframe)
  if (!canRender && !debug) {
    return null;
  }

  // If can't render but debug mode is on, show error details
  if (!canRender && debug) {
    return (
      <div style={{ 
        padding: '16px', 
        border: '2px solid #ff6b6b',
        borderRadius: '8px',
        backgroundColor: '#fff5f5',
        fontFamily: 'monospace',
        fontSize: '12px',
        ...style 
      }}>
        <div style={{ fontWeight: 'bold', color: '#c92a2a', marginBottom: '8px' }}>
          MCP App Render Error
        </div>
        <div style={{ color: '#666' }}>
          <strong>App ID:</strong> {mcpAppId}<br/>
          <strong>Error:</strong> {renderError || 'Unknown error'}<br/>
          <strong>URL:</strong> {iframeSrc || effectiveUrl || mcpAppData?.url || 'none'}<br/>
          <strong>Status:</strong> {status}<br/>
          <strong>Has HTML:</strong> {mcpAppData?.html ? 'yes' : 'no'}
        </div>
      </div>
    );
  }

  // If initialization failed, show retry UI
  if (initFailed) {
    return (
      <div style={{ 
        padding: '16px', 
        textAlign: 'center', 
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        backgroundColor: '#fafafa',
        ...style 
      }}>
        <p style={{ margin: '0 0 8px 0', color: '#666' }}>
          Unable to load interactive content
        </p>
        {debug && initError && (
          <p style={{ margin: '0 0 8px 0', color: '#999', fontSize: '12px', fontFamily: 'monospace' }}>
            {initError}
          </p>
        )}
        <button 
          onClick={resetIframe}
          style={{ 
            padding: '8px 16px', 
            cursor: 'pointer',
            borderRadius: '4px',
            border: '1px solid #ccc',
            backgroundColor: '#fff',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Normal render
  return (
    <iframe
      ref={iframeRef}
      src={iframeSrc}
      title={`mcp-app-${mcpAppId}`}
      onLoad={handleIframeLoad}
      style={{
        width,
        height: effectiveHeight,
        border: 'none',
        ...style,
      }}
      sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
    />
  );
}
