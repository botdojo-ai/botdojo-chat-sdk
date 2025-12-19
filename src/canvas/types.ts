/**
 * Canvas types for inline canvas cards in chat widgets
 */

import type React from 'react';
// Re-export ModelContext from the main package (it's re-exported from botdojo-sdk-types)
import type { ModelContext } from '../index';

export type CanvasMode = 'dojo' | 'mcp-app';

export interface MessageAckEntry {
  status: 'pending' | 'received' | 'responded' | 'error';
  payload?: any;
  error?: string;
  ts: number;
}

export interface UiSize {
  width: number;
  height: number;
}

export interface CanvasActionOptions {
  /** Optional messageId to correlate request/response */
  messageId?: string;
  /** Whether to wait for a correlated response */
  awaitResponse?: boolean;
  /** Override legacy RPC mirroring */
  mirrorLegacyCanvasRpc?: boolean;
  /** Optional timeout for awaiting responses */
  responseTimeoutMs?: number;
}

export interface BotDojoConnector {
  executeToolCall: (toolName: string, args: any) => Promise<any>;
  run: (params: any) => Promise<any>;
  init: () => Promise<void>;
  close: () => void;
  updateState: (state: any) => Promise<any>;
  [key: string]: any;
}

export type CanvasEvent = 
  | 'canvas:ready' 
  | 'canvas:update' 
  | 'message' 
  | 'token' 
  | 'complete' 
  | 'error'
  | 'tool:args_streaming'
  | 'tool:executing'
  | 'tool:complete'
  | 'tool:error'
  | 'mcp-app:render-data'
  | 'mcp-app:message-received'
  | 'mcp-app:message-response'
  | 'mcp-app:botdojo-tool-update'
  | 'mcp-app:tool-input'
  | 'mcp-app:tool-cancelled'
  | 'mcp-app:tool-result'
  | 'mcp-app:host-context-changed'
  | 'mcp-app:initial-data';

export interface UseBotDojoCanvasReturn {
  /** Whether the canvas is ready */
  isReady: boolean;
  /** Error if any */
  error: Error | null;
  /** Canvas data for this card */
  canvasData: any | null;
  /** Render data pushed via host lifecycle */
  renderData?: any;
  /** Last correlated ack/response */
  lastAck?: { messageId: string; status: MessageAckEntry['status']; payload?: any; error?: string; ts: number };
  /** Map of messageId -> ack/response state */
  messageIdMap?: Record<string, MessageAckEntry>;
  /** Last measured UI size */
  uiSize?: UiSize | null;
  /** Active mode */
  mode: CanvasMode;
  
  /** Tool execution info (for tool canvas templates) */
  toolName?: string;
  toolDisplayName?: string;
  toolPhase?: "streaming_args" | "executing" | "complete" | "error";
  toolStatus?: "processing" | "complete" | "error";
  
  /** Argument streaming (pre-execution, only during streaming_args phase) */
  partialArguments?: string;
  parsedArguments?: any;
  
  toolError?: string;
  
  /** Send message in the chat (triggers flow) */
  sendMessage: (text: string, params?: any, options?: CanvasActionOptions) => Promise<any>;
  
  /** Send a link action to the parent (navigation) */
  sendLink: (url: string, target?: '_self' | '_blank', options?: CanvasActionOptions) => Promise<any> | void;
  
  /** Send an intent action to the parent */
  sendIntent: (intent: string, params?: Record<string, any>, options?: CanvasActionOptions) => Promise<any> | void;
  
  /** Send a notification to the parent */
  sendNotify: (message: string, params?: Record<string, any>, options?: CanvasActionOptions) => Promise<any> | void;
  
  /** Send a prompt to the parent (triggers agent response) */
  sendPrompt: (prompt: string, params?: Record<string, any>, options?: CanvasActionOptions) => Promise<any> | void;

  /** Send a tool/callTool action */
  sendTool?: (toolName: string, args?: any, options?: CanvasActionOptions) => Promise<any>;

  /** Send an update action (canvas data) */
  sendUpdate?: (data: any, options?: CanvasActionOptions) => Promise<any>;

  /** Low-level dispatch hook */
  dispatchUIAction?: (action: { type: string; payload?: any; messageId?: string }, options?: CanvasActionOptions) => Promise<any>;
  
  /** Access to chat connector */
  connector: BotDojoConnector | null;
  
  /** Listen to events */
  on: (event: CanvasEvent, handler: (data: any) => void) => () => void;
  
  /** Whether in mock mode */
  isMockMode: boolean;
}

export interface BotDojoCanvasProviderProps {
  children: React.ReactNode;
  /** Canvas data for this card */
  canvasData?: any;
  /** Connector from parent chat widget */
  connector?: BotDojoConnector;
  /** Optional canvas tools (agent can call these) */
  modelContext?: ModelContext | ModelContext[];
  /** Debug mode */
  debug?: boolean;
  /** Canvas runtime mode */
  mode?: CanvasMode;
  /** Initial render data for MCP-UI lifecycle */
  initialRenderData?: any;
  /** Mirror MCP-UI actions to legacy canvas_* RPCs */
  mirrorLegacyCanvasRpc?: boolean;
}

export interface MockCanvasProviderProps {
  children: React.ReactNode;
  /** Mock canvas data */
  mockCanvasData?: any;
  /** Mock message handler */
  onSendMessage?: (text: string, params?: any) => Promise<any>;
  /** Debug mode */
  debug?: boolean;
}

export interface CanvasContextValue {
  isReady: boolean;
  error: Error | null;
  canvasData: any | null;
  renderData?: any;
  lastAck?: { messageId: string; status: MessageAckEntry['status']; payload?: any; error?: string; ts: number };
  messageIdMap?: Record<string, MessageAckEntry>;
  uiSize?: UiSize | null;
  mode: CanvasMode;
  connector: BotDojoConnector | null;
  isMockMode: boolean;
  
  // Tool execution info (for tool canvas templates)
  toolName?: string;
  toolDisplayName?: string;
  toolPhase?: "streaming_args" | "executing" | "complete" | "error";
  toolStatus?: "processing" | "complete" | "error";
  
  // Argument streaming (pre-execution, only during streaming_args phase)
  partialArguments?: string;
  parsedArguments?: any;
  
  toolError?: string;
  
  sendMessage: (text: string, params?: any, options?: CanvasActionOptions) => Promise<any>;
  sendLink: (url: string, target?: '_self' | '_blank', options?: CanvasActionOptions) => Promise<any> | void;
  sendIntent: (intent: string, params?: Record<string, any>, options?: CanvasActionOptions) => Promise<any> | void;
  sendNotify: (message: string, params?: Record<string, any>, options?: CanvasActionOptions) => Promise<any> | void;
  sendPrompt: (prompt: string, params?: Record<string, any>, options?: CanvasActionOptions) => Promise<any> | void;
  sendTool?: (toolName: string, args?: any, options?: CanvasActionOptions) => Promise<any>;
  sendUpdate?: (data: any, options?: CanvasActionOptions) => Promise<any>;
  dispatchUIAction?: (action: { type: string; payload?: any; messageId?: string }, options?: CanvasActionOptions) => Promise<any>;
  on: (event: CanvasEvent, handler: (data: any) => void) => () => void;
}

// ============================================================================
// MCP App Provider Types (mirrors AppBridge events)
// ============================================================================

export type AppEvent =
  | 'app:initialized'
  | 'app:tool-input'
  | 'app:tool-input-partial'
  | 'app:tool-result'
  | 'app:tool-cancelled'
  | 'app:host-context-changed'
  | 'app:size-change'
  | 'app:resource-teardown';

export interface AppContextValue {
  /** Whether the app is initialized */
  isInitialized: boolean;
  /** Error if any */
  error: Error | null;
  /** Host capabilities */
  hostCapabilities?: {
    openLinks?: {};
    'botdojo/persistence'?: boolean;
    [key: string]: any;
  };
  /** Host context (theme, viewport, etc.) */
  hostContext?: {
    theme?: 'light' | 'dark';
    viewport?: { width: number; height: number };
    initialData?: any;
    [key: string]: any;
  };
  /** Current tool being executed */
  toolName?: string;
  /** Tool arguments (from tool-input) */
  toolArguments?: Record<string, unknown>;
  /** Partial tool arguments (from tool-input-partial, streaming) */
  partialToolArguments?: Record<string, unknown>;
  /** Tool result */
  toolResult?: any;
  /** UI size */
  size?: { width: number; height: number };
  
  /** Send message to host */
  sendMessage: (content: Array<{ type: string; text?: string; [key: string]: any }>) => Promise<void>;
  /** Open a link */
  openLink: (url: string) => Promise<void>;
  /** Send intent action */
  sendIntent: (intent: string, params?: Record<string, any>) => Promise<any>;
  /** Send prompt action */
  sendPrompt: (prompt: string, params?: Record<string, any>) => Promise<any>;
  /** Send notify action */
  sendNotify: (message: string, params?: Record<string, any>) => Promise<void>;
  /** Send update action */
  sendUpdate: (data: Record<string, any>) => Promise<void>;
  /** Call a tool */
  callTool: (tool: string, params?: Record<string, any>) => Promise<any>;
  /** Read a resource */
  readResource: (uri: string, mimeType?: string, metadataOnly?: boolean) => Promise<any>;
  /** Notify host of size change */
  notifySizeChange: (width: number, height: number) => void;
  
  /** Listen to app events */
  on: (event: AppEvent, handler: (data: any) => void) => () => void;
}

export interface BotDojoAppProviderProps {
  children: React.ReactNode;
  /** Debug mode */
  debug?: boolean;
  /** Initial host context (for hydration) */
  initialHostContext?: {
    theme?: 'light' | 'dark';
    viewport?: { width: number; height: number };
    initialData?: any;
    [key: string]: any;
  };
}
