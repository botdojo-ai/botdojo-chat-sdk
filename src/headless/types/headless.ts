/**
 * Headless Chat Types
 * 
 * Types for the Headless Chat SDK. These types build on BotDojo's core types
 * (FlowRequestIntermediateStep, TokenUpdate, FlowCanvas) and add minimal wrapper
 * types for the React state management layer.
 */

import { FlowRequestStep, Core_TokenUpdate, Core_FlowCanvas, ModelContext } from '@botdojo/sdk-types';
import { BotDojoConnector } from '../../connector';
import { RPCConnection } from 'botdojo-rpc';
import type { McpAppData } from '../context/McpAppHostContext';



// ============================================================================
// MCP App Action Types (SEP-1865)
// ============================================================================

/**
 * Action from an MCP App embedded iframe (SEP-1865 aligned)
 * 
 * Types map to MCP Apps JSON-RPC methods:
 * - 'open-link' → ui/open-link
 * - 'tool-call' → tools/call  
 * - 'message' → ui/message
 */
export interface AppAction {
  type: 'open-link' | 'tool-call' | 'message';
  appId: string;
  payload: any;
}

// ============================================================================
// Message State Types
// ============================================================================

/**
 * Chat message for headless rendering
 * Wraps BotDojo's ChatMessage with additional UI state
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string; // Accumulated text content
  timestamp: Date;
  status: 'sending' | 'streaming' | 'complete' | 'error';

  // Steps array - contains ALL operations in this message
  // Steps come from SDK's FlowRequestStep (clean terminology)
  steps: FlowRequestStep[];
}

// ============================================================================
// Provider State
// ============================================================================

export interface HeadlessChatState {
  isReady: boolean;
  error: Error | null;
  messages: ChatMessage[];
  status: 'idle' | 'loading' | 'streaming' | 'error';
  sessionId: string | null;
}

// ============================================================================
// Event Types (from iframe to parent)
// ============================================================================

export type HeadlessEvent =
  // System events
  | { type: 'ready' }
  | { type: 'error'; error: string; messageId?: string; stepId?: string }

  // Message lifecycle
  | { type: 'message_start'; messageId: string; role: 'user' | 'assistant' | 'system' }
  | { type: 'message_complete'; messageId: string; content: string }

  // Step updates (from SDK's FlowRequestStep - clean terminology)
  | { type: 'step_update'; messageId: string; step: FlowRequestStep }

  // Token streaming (directly from BotDojo's onNewToken)
  | { type: 'token'; messageId: string; tokenUpdate: Core_TokenUpdate }

  // Session events
  | { type: 'request_aborted' };

// ============================================================================
// Action Types (parent to iframe and internal)
// ============================================================================

export type HeadlessAction =
  | { type: 'READY' }
  | { type: 'ERROR'; error: Error }
  | { type: 'SET_SESSION'; sessionId: string }
  | { type: 'MESSAGE_START'; messageId: string; role: string }
  | { type: 'MESSAGE_COMPLETE'; messageId: string; content: string }
  | { type: 'STEP_UPDATE'; messageId: string; step: FlowRequestStep }
  | { type: 'TOKEN'; messageId: string; tokenUpdate: Core_TokenUpdate }
  | { type: 'REQUEST_ABORTED' }
  | { type: 'SEND_MESSAGE'; text: string };

// ============================================================================
// Hook Return Types
// ============================================================================

export interface BotDojoChatHook {
  state: {
    status: 'idle' | 'loading' | 'streaming' | 'error';
    isReady: boolean;
    error: Error | null;
  };
  actions: {
    sendMessage: (text: string) => void;
    abortRequest: () => void;
    bargeInRequest: (text: string) => void;
    setSessionId: (sessionId: string) => void;
    reload: () => void;
  };
}

export interface ChatMessagesHook {
  messages: ChatMessage[];
  currentMessage: ChatMessage | null;
  isStreaming: boolean;
}

export interface ChatStatusHook {
  status: 'idle' | 'loading' | 'streaming' | 'error';
  isReady: boolean;
  error: Error | null;
  sessionId: string | null;
}

export interface ChatActionsHook {
  sendMessage: (text: string) => void;
  abortRequest: () => void;
  bargeInRequest: (text: string) => void;
  setSessionId: (sessionId: string) => void;
  reload: () => void;
  /** Persist MCP App state to the server */
  persistAppState: (appId: string, state: Record<string, any>) => void;
}

// ============================================================================
// Provider Props
// ============================================================================

export interface BotDojoChatProviderProps {
  apiKey: string;
  modelContext?: ModelContext | ModelContext[];
  baseUrl?: string;
  sessionId?: string;
  newSession?: boolean;
  children: React.ReactNode;
  onError?: (error: Error) => void;
  onReady?: () => void;
  onSessionCreated?: (sessionId: string) => void;
  onSessionHydrated?: (messageCount: number) => void;
  /** @deprecated Connector is no longer used in headless mode. Callback receives null. */
  onConnectorInit?: (connector: BotDojoConnector | null) => void;
  onConnectorError?: (error: Error) => void;
  
  /**
   * Enable debug mode for MCP App rendering.
   * When true, shows detailed error messages if MCP Apps fail to render.
   * When false (default), silently returns null for failed MCP Apps.
   * @default false
   */
  debug?: boolean;
  
  // MCP App event callbacks (matching BotDojoChat API)
  /**
   * Called when an MCP App requests to open a link (ui/open-link)
   * The host application should handle navigation - links are NOT automatically opened
   * @param url - The URL to open
   * @param target - Target window ('_blank', '_self', etc.)
   * @param appId - The MCP App ID that sent the event
   */
  onOpenLink?: (url: string, target: string, appId: string) => void;
  
  /**
   * Called when an MCP App requests a tool execution (tools/call) or sends an intent
   * @param tool - The tool name to execute
   * @param params - Tool parameters
   * @param appId - The MCP App ID that sent the event
   * @returns Tool execution result (async)
   */
  onToolCall?: (tool: string, params: any, appId: string) => Promise<any> | void;
  
  /**
   * Called when an MCP App sends a UI message (ui/message)
   * This includes notify, prompt, update, and general message events
   * @param message - The message content or payload
   * @param params - Additional message parameters
   * @param appId - The MCP App ID that sent the event
   */
  onUiMessage?: (message: string, params: any, appId: string) => void;
}

// ============================================================================
// Context Type
// ============================================================================

export interface BotDojoChatContextType {
  state: HeadlessChatState;
  dispatch: React.Dispatch<HeadlessAction>;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  connector?: BotDojoConnector | null;
  connection?: RPCConnection | null;
  registerMcpApp?: (appId: string, iframeWindow: Window) => void;
  unregisterMcpApp?: (appId: string) => void;
  registeredMcpApps?: Set<string>;
  
  /**
   * Debug mode flag - when true, MCP App rendering errors are displayed
   * instead of silently returning null.
   */
  debug?: boolean;
  
  // Tool notification sender registration for streaming updates
  registerToolNotificationSender?: (appId: string, sender: (method: string, params: any) => void) => (() => void);
  
  // Send tool notification to a specific MCP App by ID (instead of broadcasting)
  sendToolNotificationToApp?: (appId: string, method: string, params: any) => void;
  
  // Step update callback registration - MCP App registers to receive targeted updates
  registerStepUpdateCallback?: (appId: string, callback: (stepUpdate: any) => void) => (() => void);
  
  // Send step update to a specific MCP App via its registered callback
  sendStepUpdateToApp?: (appId: string, stepUpdate: any) => void;
  
  /**
   * Get cached MCP App data by ID.
   * McpAppHost calls this to get HTML, arguments, result, etc.
   * The cache is populated when:
   * - ui:// URLs are resolved to HTML
   * - Tool arguments are received during streaming
   * - Tool results are received
   * 
   * This allows McpAppHost to get its data without the parent
   * component needing to pass it as props.
   */
  getMcpAppData?: (appId: string) => McpAppData | null;
  
  /**
   * Version counter that increments when MCP App data cache is updated.
   * Components can depend on this to trigger re-renders when cache changes.
   */
  mcpAppDataVersion?: number;
  
  /**
   * Get a resource by URI from the model context.
   * Used for resolving ui:// resources on demand (e.g., during hydration).
   */
  getResource?: (uri: string, params?: any, onlyMetadata?: boolean) => Promise<any>;

  // MCP App handlers (ref to avoid re-renders) - matches BotDojoChat API
  appHandlers?: React.RefObject<{
    onOpenLink?: (url: string, target: string, appId: string) => void;
    onToolCall?: (tool: string, params: any, appId: string) => Promise<any> | void;
    onUiMessage?: (message: string, params: any, appId: string) => void;
  }>;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a value that may be a JSON string into an object.
 * Returns the original value if it's already an object or can't be parsed.
 * Returns undefined for empty/null/undefined values.
 * 
 * @param value - Value to parse (can be string, object, or any)
 * @returns Parsed object, original value, or undefined
 */
export function parseMaybeJson(value: any): Record<string, unknown> | any {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object') return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      return JSON.parse(value);
    } catch {
      // Return string as-is if not valid JSON
      return value;
    }
  }
  return value;
}

/**
 * Extract MCP App data from a step for hydration.
 * 
 * This handles multiple data sources and formats that occur during:
 * - Live streaming (stepToolArguments, stepToolResult populated)
 * - Hydration from server (arguments as JSON string, result in canvasData)
 * - Persisted state (state in canvasData)
 * 
 * @param step - The step from ChatMessage.steps (FlowRequestStep or raw server step)
 * @param options - Additional options
 * @returns McpAppData object ready for McpAppHost, or null if step has no canvas
 * 
 * @example
 * ```tsx
 * const mcpApps = message.steps
 *   .map(step => extractMcpAppData(step, { isComplete: message.status === 'complete' }))
 *   .filter(Boolean);
 * 
 * {mcpApps.map(app => (
 *   <McpAppHost key={app.mcpAppId} mcpAppId={app.mcpAppId} mcpAppData={app} />
 * ))}
 * ```
 */
export function extractMcpAppData(
  step: FlowRequestStep | any,
  options?: {
    /** Whether the parent message is complete */
    isComplete?: boolean;
  }
): McpAppData | null {
  const canvas = step?.canvas;
  if (!canvas?.canvasId) {
    return null;
  }

  // Get tool name from step or canvas data
  const toolName = step.stepToolName || canvas.canvasData?.toolName;

  // Build tool arguments from multiple sources (for hydration)
  // Priority: stepToolArguments > parsed arguments string > canvasData.arguments
  let toolArguments = step.stepToolArguments;
  if (!toolArguments || (typeof toolArguments === 'object' && Object.keys(toolArguments).length === 0)) {
    // Try parsing raw 'arguments' string (server sends this during streaming)
    toolArguments = parseMaybeJson(step.arguments);
  }
  if (!toolArguments || (typeof toolArguments === 'object' && Object.keys(toolArguments).length === 0)) {
    // Fall back to canvas data (may be persisted there)
    toolArguments = parseMaybeJson(canvas.canvasData?.arguments);
  }

  // Build tool result from multiple sources (for hydration)
  // Priority: stepToolResult > canvasData.result > content (when tool is complete)
  let toolResult = step.stepToolResult;
  if (toolResult === undefined || toolResult === '') {
    toolResult = parseMaybeJson(canvas.canvasData?.result);
  }
  if (toolResult === undefined || toolResult === '') {
    // Fall back to step content when tool execution is complete
    const toolPhase = step.stepToolPhase || step.toolPhase;
    if (toolPhase === 'complete' && step.content) {
      toolResult = parseMaybeJson(step.content);
    }
  }

  return {
    mcpAppId: canvas.canvasId,
    mcpAppType: canvas.canvasType || 'mcp-app',
    url: canvas.canvasData?.url,
    html: canvas.canvasData?.html,
    height: canvas.canvasData?.height,
    width: canvas.canvasData?.width,
    state: canvas.canvasData?.state,
    arguments: toolArguments,
    result: toolResult,
    isComplete: options?.isComplete ?? false,
    // Include toolInfo for hydration - McpAppHost needs tool.name to send notifications
    toolInfo: toolName ? { tool: { name: toolName } } : undefined,
  };
}
