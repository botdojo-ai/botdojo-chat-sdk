/**
 * @deprecated Legacy canvas components for inline canvas cards in chat widgets.
 * 
 * **This module is deprecated.** For MCP Apps (SEP-1865), use:
 * 
 * - Host side: `McpAppHost` component from `@botdojo/sdk-chat`
 * - App side: `useMcpApp` hook from `mcp-app-view/react`
 * 
 * @example Host side (parent page rendering MCP App iframes)
 * ```tsx
 * import { McpAppHost } from '@botdojo/sdk-chat';
 * 
 * <McpAppHost
 *   mcpAppId={step.mcpApp.mcpAppId}
 *   mcpAppData={step.mcpApp}
 *   onToolCall={handleToolCall}
 *   onOpenLink={handleOpenLink}
 * />
 * ```
 * 
 * @example App side (inside the MCP App iframe)
 * ```tsx
 * import { useMcpApp } from 'mcp-app-view/react';
 * 
 * function MyApp() {
 *   const { isInitialized, tool, sendMessage } = useMcpApp();
 *   // ...
 * }
 * ```
 * 
 * Legacy canvas providers (will be removed in future versions):
 * - BotDojoCanvasProvider: For production canvas cards (inside chat widget)
 * - MockCanvasProvider: For testing/development (standalone)
 * - useBotDojoCanvas: Hook to access canvas runtime
 */

/** @deprecated Use McpAppHost instead */
export { BotDojoCanvasProvider } from './BotDojoCanvasProvider';
/** @deprecated Use McpAppHost instead */
export { MockCanvasProvider } from './MockCanvasProvider';
/** @deprecated Use useMcpApp from mcp-app-view/react instead */
export { useBotDojoCanvas } from './useBotDojoCanvas';

// Types (deprecated - use MCP App types instead)
export type {
  BotDojoCanvasProviderProps,
  MockCanvasProviderProps,
  UseBotDojoCanvasReturn,
  AppContextValue,
  CanvasEvent,
  AppEvent,
  BotDojoConnector,
  CanvasMode,
  CanvasActionOptions,
  UiSize,
} from './types';
