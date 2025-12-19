/**
 * McpAppHostContext
 * 
 * Context for managing MCP App hosts in headless chat.
 * Handles registration, event routing, and bidirectional communication.
 */

import React, { createContext, useCallback, useRef, useState, useMemo } from 'react';

/**
 * Data structure for MCP App content and state
 */
export interface McpAppData {
  mcpAppId: string;
  mcpAppType?: 'mcp-app' | 'dojo-canvas' | 'iframe';
  
  // App content (one of these):
  url?: string;
  html?: string;
  
  // Persisted state (BotDojo extension):
  state?: Record<string, any>;
  
  // Size hints:
  height?: string;
  width?: string;
  
  // SEP-1865 spec-compliant tool info:
  toolInfo?: {
    id?: string | number;
    tool: {
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    };
  };
  
  // Tool arguments and result for hydration (sent after app initialized)
  arguments?: Record<string, unknown>;
  result?: unknown;
  
  // Indicates if the tool execution is complete (for hydration scenarios)
  // When true and result is undefined, McpAppHost sends synthetic tool-result
  isComplete?: boolean;
}

/**
 * Registered app entry with iframe reference
 */
interface RegisteredApp {
  mcpAppId: string;
  iframeWindow: Window;
  pendingRequests: Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>;
}

/**
 * Context value for MCP App host management
 */
export interface McpAppHostContextValue {
  // Registration
  registerApp: (mcpAppId: string, iframeWindow: Window) => void;
  unregisterApp: (mcpAppId: string) => void;
  registeredApps: Set<string>;
  
  // Lookup by source - returns mcpAppId for the iframe that sent the message
  findAppIdBySource: (source: Window | MessageEventSource | null) => string | null;
  
  // Host → App communication
  sendToApp: (mcpAppId: string, method: string, params?: any) => Promise<any>;
  broadcastToApps: (method: string, params?: any) => void;
  
  // Event handlers (set by provider/user)
  onOpenLink?: (url: string, target: string, mcpAppId: string) => void;
  onToolCall?: (tool: string, params: any, mcpAppId: string) => Promise<any>;
  onUiMessage?: (message: string, params: any, mcpAppId: string) => void;
  onPersistState?: (state: Record<string, any>, mcpAppId: string) => void;
}

export const McpAppHostContext = createContext<McpAppHostContextValue | null>(null);

/**
 * Props for McpAppHostProvider
 */
export interface McpAppHostProviderProps {
  children: React.ReactNode;
  
  /**
   * Called when an MCP App requests to open a link (ui/open-link)
   */
  onOpenLink?: (url: string, target: string, mcpAppId: string) => void;
  
  /**
   * Called when an MCP App requests a tool execution (tools/call)
   * Return value is sent back to the app as the response
   */
  onToolCall?: (tool: string, params: any, mcpAppId: string) => Promise<any>;
  
  /**
   * Called when an MCP App sends a UI message (ui/message)
   */
  onUiMessage?: (message: string, params: any, mcpAppId: string) => void;
  
  /**
   * Called when an MCP App wants to persist state (ui/message with botdojo/messageType: 'persist-state')
   */
  onPersistState?: (state: Record<string, any>, mcpAppId: string) => void;
  
  /**
   * Enable debug logging
   */
  debug?: boolean;
}

/**
 * Provider component for MCP App host management
 */
export function McpAppHostProvider(props: McpAppHostProviderProps): JSX.Element {
  const { children, onOpenLink, onToolCall, onUiMessage, onPersistState, debug = false } = props;
  
  const registeredAppsRef = useRef<Map<string, RegisteredApp>>(new Map());
  const [registeredAppIds, setRegisteredAppIds] = useState<Set<string>>(new Set());
  const nextRequestId = useRef(0);
  
  const log = useCallback((...args: any[]) => {
    if (debug) {
      console.log('[McpAppHostContext]', ...args);
    }
  }, [debug]);
  
  /**
   * Register an MCP App iframe
   */
  const registerApp = useCallback((mcpAppId: string, iframeWindow: Window) => {
    log('Registering app:', mcpAppId);
    
    if (registeredAppsRef.current.has(mcpAppId)) {
      log('App already registered, updating window reference:', mcpAppId);
    }
    
    registeredAppsRef.current.set(mcpAppId, {
      mcpAppId,
      iframeWindow,
      pendingRequests: new Map(),
    });
    
    setRegisteredAppIds(prev => new Set(prev).add(mcpAppId));
  }, [log]);
  
  /**
   * Unregister an MCP App iframe
   */
  const unregisterApp = useCallback((mcpAppId: string) => {
    log('Unregistering app:', mcpAppId);
    
    const app = registeredAppsRef.current.get(mcpAppId);
    if (app) {
      // Reject any pending requests
      app.pendingRequests.forEach(({ reject }) => {
        reject(new Error('App unregistered'));
      });
    }
    
    registeredAppsRef.current.delete(mcpAppId);
    setRegisteredAppIds(prev => {
      const next = new Set(prev);
      next.delete(mcpAppId);
      return next;
    });
  }, [log]);
  
  /**
   * Find app ID by message source window
   * This is the authoritative way to route messages to the correct app
   */
  const findAppIdBySource = useCallback((source: Window | MessageEventSource | null): string | null => {
    if (!source) return null;
    
    for (const [mcpAppId, app] of registeredAppsRef.current.entries()) {
      if (app.iframeWindow === source) {
        return mcpAppId;
      }
    }
    
    return null;
  }, []);
  
  /**
   * Send a JSON-RPC request to a specific app
   */
  const sendToApp = useCallback(async (mcpAppId: string, method: string, params?: any): Promise<any> => {
    const app = registeredAppsRef.current.get(mcpAppId);
    if (!app) {
      throw new Error(`App not registered: ${mcpAppId}`);
    }
    
    const id = `host-${++nextRequestId.current}`;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    
    log('Sending to app:', mcpAppId, method, params);
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        app.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 10000);
      
      app.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      });
      
      app.iframeWindow.postMessage(request, '*');
    });
  }, [log]);
  
  /**
   * Broadcast a notification to all registered apps
   */
  const broadcastToApps = useCallback((method: string, params?: any) => {
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    
    log('Broadcasting to all apps:', method, params);
    
    registeredAppsRef.current.forEach((app) => {
      try {
        app.iframeWindow.postMessage(notification, '*');
      } catch (err) {
        log('Failed to broadcast to app:', app.mcpAppId, err);
      }
    });
  }, [log]);
  
  const contextValue = useMemo<McpAppHostContextValue>(() => ({
    registerApp,
    unregisterApp,
    registeredApps: registeredAppIds,
    findAppIdBySource,
    sendToApp,
    broadcastToApps,
    onOpenLink,
    onToolCall,
    onUiMessage,
    onPersistState,
  }), [
    registerApp,
    unregisterApp,
    registeredAppIds,
    findAppIdBySource,
    sendToApp,
    broadcastToApps,
    onOpenLink,
    onToolCall,
    onUiMessage,
    onPersistState,
  ]);
  
  return (
    <McpAppHostContext.Provider value={contextValue}>
      {children}
    </McpAppHostContext.Provider>
  );
}

