import { useState, useCallback, useMemo, useEffect } from 'react';
import type { MockCanvasProviderProps, CanvasEvent } from './types';
import { CanvasContext } from './CanvasContext';

let hasWarnedDeprecation = false;

/**
 * @deprecated Use `useMcpApp` from `mcp-app-view/react` instead.
 * This provider will be removed in a future version.
 * 
 * For testing MCP Apps, create mock data and pass as initialState to useMcpApp.
 * 
 * Migration:
 * ```tsx
 * // Before
 * import { MockCanvasProvider, useBotDojoCanvas } from '@botdojo/chat-sdk';
 * 
 * <MockCanvasProvider mockCanvasData={data}>
 *   <MyCanvas />
 * </MockCanvasProvider>
 * 
 * // After - no provider needed
 * import { useMcpApp } from 'mcp-app-view/react';
 * 
 * function MyCanvas() {
 *   const { state, tool } = useMcpApp({
 *     initialState: mockData,
 *   });
 * }
 * ```
 */
export function MockCanvasProvider({
  children,
  mockCanvasData,
  onSendMessage,
  debug = false
}: MockCanvasProviderProps) {
  const [eventHandlers] = useState<Map<string, Set<Function>>>(new Map());

  // Warn once about deprecation
  useEffect(() => {
    if (!hasWarnedDeprecation) {
      hasWarnedDeprecation = true;
      console.warn(
        '[DEPRECATED] MockCanvasProvider is deprecated. ' +
        'Use useMcpApp from mcp-app-view/react with initialState instead. ' +
        'See migration guide: https://docs.botdojo.com/migration/mcp-apps'
      );
    }
  }, []);

  const log = useCallback((...args: any[]) => {
    if (debug) {
      console.log('[MockCanvas]', ...args);
    }
  }, [debug]);

  const sendMessage = useCallback(async (text: string, params?: any) => {
    log('Mock sendMessage called', { text, params });
    
    if (onSendMessage) {
      try {
        const result = await onSendMessage(text, params);
        log('Mock sendMessage result', result);
        
        // Emit message event
        const handlers = eventHandlers.get('message');
        if (handlers) {
          handlers.forEach(handler => {
            try {
              handler(result);
            } catch (err) {
              console.error('[MockCanvas] Error in message handler:', err);
            }
          });
        }
        
        return result;
      } catch (err) {
        log('Mock sendMessage error', err);
        
        // Emit error event
        const handlers = eventHandlers.get('error');
        if (handlers) {
          handlers.forEach(handler => {
            try {
              handler(err);
            } catch (e) {
              console.error('[MockCanvas] Error in error handler:', e);
            }
          });
        }
        
        throw err;
      }
    }
    
    // Default mock response
    log('No onSendMessage handler, returning default mock response');
    return {
      success: true,
      aiMessage: {
        content: `Mock response to: ${text}`,
        role: 'assistant'
      }
    };
  }, [onSendMessage, eventHandlers, log]);

  const on = useCallback((event: CanvasEvent, handler: (data: any) => void) => {
    log('Registering mock event handler', event);
    
    if (!eventHandlers.has(event)) {
      eventHandlers.set(event, new Set());
    }
    
    const handlers = eventHandlers.get(event)!;
    handlers.add(handler);
    
    // Return unsubscribe function
    return () => {
      log('Unregistering mock event handler', event);
      handlers.delete(handler);
    };
  }, [eventHandlers, log]);

  const contextValue = useMemo(() => ({
    isReady: true,  // Mock is always ready
    error: null,
    renderData: mockCanvasData?.renderData,
    lastAck: undefined,
    messageIdMap: {},
    uiSize: null,
    mode: 'dojo',
    connector: null,
    isMockMode: true,
    sendMessage,
    sendLink: async () => undefined,
    sendIntent: async () => undefined,
    sendNotify: async () => undefined,
    sendPrompt: async () => undefined,
    sendTool: async () => undefined,
    sendUpdate: async () => undefined,
    dispatchUIAction: async () => undefined,
    on,
    // Spread mockCanvasData to include canvasData and tool execution fields
    ...(mockCanvasData || {}),
    // Ensure canvasData defaults to mockCanvasData if not explicitly set
    canvasData: mockCanvasData?.canvasData || mockCanvasData || null,
  }), [mockCanvasData, sendMessage, on]);

  return (
    <CanvasContext.Provider value={contextValue}>
      {children}
    </CanvasContext.Provider>
  );
}
