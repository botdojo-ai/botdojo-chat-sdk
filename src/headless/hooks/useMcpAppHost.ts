/**
 * useMcpAppHost Hook
 * 
 * Hook to access the MCP App host context for registration and event handling.
 * Returns null if not within a McpAppHostProvider (allows standalone McpAppHost usage).
 */

import { useContext } from 'react';
import { McpAppHostContext, McpAppHostContextValue } from '../context/McpAppHostContext';

/**
 * Access the MCP App host context.
 * Returns null if not within a McpAppHostProvider, allowing McpAppHost
 * to work both with and without the provider.
 */
export function useMcpAppHost(): McpAppHostContextValue | null {
  return useContext(McpAppHostContext);
}

/**
 * Access the MCP App host context, throwing if not available.
 * Use this when you require the context to be present.
 */
export function useMcpAppHostRequired(): McpAppHostContextValue {
  const context = useContext(McpAppHostContext);
  
  if (!context) {
    throw new Error('useMcpAppHostRequired must be used within McpAppHostProvider');
  }
  
  return context;
}











