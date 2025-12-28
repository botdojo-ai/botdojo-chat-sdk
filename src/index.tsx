export { BotDojoChat } from './BotDojoChat';
export type { 
    BotDojoChatProps, 
    BotDojoChatDisplayMode, 
    PopupOptions, 
    SidePanelOptions, 
    BotDojoChatControl 
} from './BotDojoChat';

export { HeadlessChat } from './headless/HeadlessChat';
export type {
    HeadlessChatProps,
    HeadlessChatHandle,
    ChatConfig,
    ChatStatus,
    HeadlessTokenEvent,
    HeadlessStepEvent,
    HeadlessStatusEvent,
    HeadlessMessageEvent,
} from './headless/HeadlessChat';

// NEW: Headless Chat SDK (Context + Hooks pattern)
export { BotDojoChatProvider } from './headless/context/BotDojoChatProvider';
export { useBotDojoChat } from './headless/hooks/useBotDojoChat';
export { useChatMessages } from './headless/hooks/useChatMessages';
export { useChatStatus } from './headless/hooks/useChatStatus';
export { useChatActions } from './headless/hooks/useChatActions';

// Canvas Frame Component (for parent page to render canvas iframes)
// NOTE: BotDojoCanvasFrame is for the PARENT page.
export { BotDojoCanvasFrame } from './headless/components/BotDojoCanvas';
export type { BotDojoCanvasFrameProps } from './headless/components/BotDojoCanvas';

// MCP App Host - Interactive MCP App iframe with full event handling
export { McpAppHost } from './headless/components/McpAppHost';
export type { McpAppHostProps } from './headless/components/McpAppHost';

// MCP App Host Context - For managing multiple MCP Apps
export { McpAppHostProvider, McpAppHostContext } from './headless/context/McpAppHostContext';
export type { McpAppHostContextValue, McpAppHostProviderProps, McpAppData } from './headless/context/McpAppHostContext';

// MCP App Host Hook
export { useMcpAppHost, useMcpAppHostRequired } from './headless/hooks/useMcpAppHost';

// NEW: Headless Chat types
export type {
  // State types
  HeadlessChatState,
  ChatMessage,
  
  // Event types
  HeadlessEvent,
  
  // Action types
  HeadlessAction,
  
  // Hook return types
  BotDojoChatHook,
  ChatMessagesHook,
  ChatStatusHook,
  ChatActionsHook,
  
  // Provider props
  BotDojoChatProviderProps,
  
  // MCP App types (SEP-1865)
  AppAction,
} from './headless/types/headless';

// Utility functions for MCP App hydration
export { 
  extractMcpAppData,
  parseMaybeJson,
} from './headless/types/headless';

// Deprecated alias: Use AppAction instead
import type { AppAction as _AppAction } from './headless/types/headless';
/** @deprecated Use AppAction instead */
export type CanvasAction = _AppAction;


// Export BotDojoConnector and RequestEvents
export { BotDojoConnector, RequestEvents } from './connector';

// Export useMcpHostBridge hook for MCP App iframe hosting
export {
  useMcpHostBridge,
  type UseMcpHostBridgeOptions,
  type UseMcpHostBridgeResult,
  type IframeState,
  type ToolInfo,
} from './hooks/useMcpHostBridge';

// Export utilities for MCP Apps
export {
  // CSP helpers
  resolveUiCsp,
  extractUiCspFromResource,
  type UiCspMeta,
  type ResolvedUiCsp,
  // MCP HTML proxy helpers
  createMcpHtmlProxy,
  buildMcpProxyUrl,
  buildMcpCacheKey,
  type McpHtmlProxyOptions,
  type McpProxyUrlOptions,
  // MCP utils
  DEFAULT_MCP_HOST_CAPABILITIES,
  getContentKey,
  validateToolParams,
  processStepUpdate,
  type StepUpdate,
  type ToolNotification,
} from './utils';

// Re-export types for TypeScript users
export type {
    // Core types for defining model contexts
    ModelContext,
    // Tool and resource types
    ToolDefinition,
    ToolExecutionContext,
    ModelContextResource,
    ModelContextPrompt,
    ModelContextMessage,
    ResourceContent,
    ResourceTemplate,
    ResourceProvider,
    // New ContentItem types
    ContentItem,
    ResourceReference,
    CitationData,
    ToolExecutionResult,
    ToolMetadata,
    // SDK tool helper types (needed for DTS bundling)
    JSONSchema,
    ZodSchema,
    SDKToolDefinition,
    ToolsRecord,
    ToolHandler,
    ModelContextDefinition,
    ResourceContentObject,
    ResourceContentResult,
    // Backend translation types
    BackendModelContext,
    BackendToolDef,
    BackendPromptDef,
    BackendResourceDef,
} from './generated/sdk-types-snapshot';

// Re-export tool helper functions for building tool responses
export {
    tool,
    modelContext,

    // ContentItem helpers
    textResult,
    imageResult,
    uiResource,
    mcpResource,
    citation,
    citations,
    // MIME type constants
    MIME_TYPES,
} from './generated/sdk-types-snapshot';

/**
 * @deprecated Legacy canvas components for inline canvas cards.
 * For MCP Apps, use McpAppHost component and useMcpApp hook from mcp-app-view/react.
 */
export {
    BotDojoCanvasProvider,
    MockCanvasProvider,
    useBotDojoCanvas,
} from './canvas';

/**
 * @deprecated Legacy canvas types. For MCP Apps, use McpAppHost and related types.
 */
export type {
    BotDojoCanvasProviderProps,
    MockCanvasProviderProps,
    UseBotDojoCanvasReturn,
    AppContextValue,
    CanvasEvent,
    AppEvent,
    CanvasMode,
    CanvasActionOptions,
    UiSize
} from './canvas';
