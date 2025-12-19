import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BotDojoConnector } from '../connector';
import type { ModelContext } from '../generated/sdk-types-snapshot';
import { extractToolHandlers } from '../generated/sdk-types-snapshot';

/**
 * Chat status during flow execution
 */
export type ChatStatus = 'idle' | 'running' | 'completed' | 'error';

/**
 * Token event fired when new text token is received
 */
export interface HeadlessTokenEvent {
  type: 'token';
  token: string;
  messageId?: string;
}

/**
 * Step event fired for intermediate flow steps
 */
export interface HeadlessStepEvent {
  type: 'step';
  step: string;
  data?: any;
}

/**
 * Status change event
 */
export interface HeadlessStatusEvent {
  type: 'status';
  status: ChatStatus;
  error?: string;
}

/**
 * Message event with full message data
 */
export interface HeadlessMessageEvent {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: string;
  messageId: string;
}

/**
 * Configuration for the chat
 */
export interface ChatConfig {
  welcomeMessage?: string;
  messageHistory?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  placeholder?: string;
  systemPrompt?: string;
}

/**
 * Props for HeadlessChat component
 */
export interface HeadlessChatProps {
  /**
   * BotDojo API key (required)
   * The API key contains all flow configuration needed
   */
  apiKey: string;

  /**
   * Model context with tools, prompts, and resources
   * Tools should include `execute` functions directly in their definitions
   */
  modelContext?: ModelContext | ModelContext[];

  /**
   * Base URL for the headless embed iframe
   * @default 'http://localhost:3000' (development)
   */
  baseUrl?: string;

  /**
   * Initial chat configuration
   */
  config?: ChatConfig;

  /**
   * Callback when status changes (idle, running, completed, error)
   */
  onStatusChange?: (status: ChatStatus, error?: string) => void;

  /**
   * Callback when new token is received
   */
  onToken?: (token: string, messageId?: string) => void;

  /**
   * Callback when intermediate step is executed
   */
  onStep?: (step: any, messageId?: string) => void;

  /**
   * Callback when an MCP App UI is attached to a step
   * @param mcpAppData - The MCP App data to render
   * @param stepId - The step ID
   * @param messageId - The message ID
   */
  onMcpApp?: (mcpAppData: any, stepId: string, messageId?: string) => void;

  /**
   * Callback when a new message starts
   */
  onMessageStart?: (role: 'user' | 'assistant' | 'system', messageId: string) => void;

  // MCP App event callbacks (following MCP App spec)
  /**
   * Called when an MCP App requests to open a link (ui/open-link)
   * The host application should handle navigation - links are NOT automatically opened
   * @param url - The URL to open
   * @param target - Target window ('_blank', '_self', etc.)
   * @param appId - The MCP App ID that sent the event
   */
  onOpenLink?: (url: string, target: string, appId: string) => void;
  /**
   * Called when an MCP App requests a tool execution (tools/call)
   * @param tool - The tool name to execute
   * @param params - Tool parameters
   * @param appId - The MCP App ID that sent the event
   * @returns Tool execution result (async)
   */
  onToolCall?: (tool: string, params: any, appId: string) => Promise<any> | void;
  /**
   * Called when an MCP App sends a UI message (ui/message)
   * @param message - The message content or payload
   * @param params - Additional message parameters
   * @param appId - The MCP App ID that sent the event
   */
  onUiMessage?: (message: string, params: any, appId: string) => void;

  /**
   * Callback when a message is complete
   */
  onMessageComplete?: (messageId: string, content: string) => void;

  /**
   * Callback when message is received (full message)
   * @deprecated Use onMessageComplete instead
   */
  onMessage?: (role: 'user' | 'assistant' | 'system', content: string, messageId: string) => void;

  /**
   * Callback when iframe is loaded and ready
   */
  onReady?: () => void;

  /**
   * Callback when error occurs
   */
  onError?: (error: string) => void;
}

/**
 * HeadlessChat component
 * 
 * A headless version of BotDojoChat that uses an iframe for BotDojo API communication
 * but lets you control the UI completely. Events are sent via postMessage.
 * 
 * @example
 * ```tsx
 * const [messages, setMessages] = useState([]);
 * const [status, setStatus] = useState('idle');
 * const headlessRef = useRef(null);
 * 
 * return (
 *   <div>
 *     <HeadlessChat
 *       apiKey="your-api-key"
 *       ref={headlessRef}
 *       onStatusChange={(status) => setStatus(status)}
 *       onToken={(token) => console.log('Token:', token)}
 *       onMessage={(role, content, id) => {
 *         setMessages(prev => [...prev, { role, content, id }]);
 *       }}
 *     />
 *     <YourCustomUI 
 *       messages={messages}
 *       status={status}
 *       onSend={(text) => headlessRef.current?.sendMessage(text)}
 *     />
 *   </div>
 * );
 * ```
 */
export const HeadlessChat = React.forwardRef<HeadlessChatHandle, HeadlessChatProps>(
  (props: HeadlessChatProps, ref) => {
    const {
      apiKey,
      modelContext,
      baseUrl = 'http://localhost:3000',
      config,
      onStatusChange,
      onToken,
      onStep,
      onMcpApp,
      onMessageStart,
      onMessageComplete,
      onMessage,
      onReady,
      onError,
      // MCP App event callbacks
      onOpenLink,
      onToolCall,
      onUiMessage,
    } = props;

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const connectorRef = useRef<BotDojoConnector | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [currentStatus, setCurrentStatus] = useState<ChatStatus>('idle');
    const [externalUIChannelId, setExternalUIChannelId] = useState<string | null>(null);
    const currentMessageRef = useRef<{ messageId: string; role: string; content: string } | null>(null);

    // Build iframe URL with query params (NO modelContext - that's handled by connector in parent)
    const iframeUrl = React.useMemo(() => {
      const url = new URL('/headless-embed', baseUrl);
      url.searchParams.set('apiKey', apiKey);
      if (externalUIChannelId) url.searchParams.set('externalUIChannelId', externalUIChannelId);
      return url.toString();
    }, [baseUrl, apiKey, externalUIChannelId]);

    // Send message to iframe
    const sendToIframe = useCallback((message: any) => {
      console.log('[HeadlessChat] sendToIframe called:', { message, isReady, hasIframe: !!iframeRef.current, hasContentWindow: !!iframeRef.current?.contentWindow });
      if (iframeRef.current?.contentWindow && isReady) {
        iframeRef.current.contentWindow.postMessage(message, '*');
        console.log('[HeadlessChat] Message sent to iframe');
      } else {
        console.warn('[HeadlessChat] Cannot send message - iframe not ready:', { isReady, hasIframe: !!iframeRef.current, hasContentWindow: !!iframeRef.current?.contentWindow });
      }
    }, [isReady]);

  // Send user message
  const sendMessage = useCallback((input: any) => {
    console.log('[HeadlessChat] sendMessage called:', input);
    sendToIframe({
      type: 'send_message',
      input,
    });
  }, [sendToIframe]);

    // Update configuration
    const updateConfig = useCallback((newConfig: ChatConfig) => {
      sendToIframe({
        type: 'update_config',
        config: newConfig,
      });
    }, [sendToIframe]);

    // Clear chat history
    const clearHistory = useCallback(() => {
      sendToIframe({
        type: 'clear_history',
      });
    }, [sendToIframe]);

    // Cancel current flow execution
    const cancelExecution = useCallback(() => {
      sendToIframe({
        type: 'cancel_execution',
      });
    }, [sendToIframe]);

    // Expose methods via ref
    React.useImperativeHandle(ref, () => ({
      sendMessage,
      updateConfig,
      clearHistory,
      cancelExecution,
      getStatus: () => currentStatus,
      isReady: () => isReady,
    }));

    // Initialize BotDojoConnector if modelContext provided (same as BotDojoChat)
    useEffect(() => {
      if (!modelContext) return;

      let mounted = true;
      
      (async () => {
        try {
          console.log('[HeadlessChat] Initializing BotDojoConnector with modelContext');
          
          // Create connector in parent window with postmessage transport
          // Only API key is required - account/project/flow IDs are optional for external MCP
          const currentConnector = new BotDojoConnector({
            apiKey,
            modelContext,
            transport: 'postmessage',
          });

          connectorRef.current = currentConnector;

          await currentConnector.init();

          if (!mounted) {
            await currentConnector.close();
            return;
          }

          // Get the external UI channel ID from the connector
          const channelId = currentConnector.getExternalUIChannelId();
          setExternalUIChannelId(channelId);

          console.log('[HeadlessChat] BotDojoConnector initialized successfully with channel ID:', channelId);
        } catch (error) {
          console.error('[HeadlessChat] Error initializing BotDojoConnector:', error);
          // Call onError if provided, but don't include it in dependencies to avoid re-initialization
          if (onError) {
            onError('Failed to initialize model context connector');
          }
        }
      })();

      return () => {
        mounted = false;
        if (connectorRef.current) {
          console.log('[HeadlessChat] Closing BotDojoConnector');
          connectorRef.current.close();
          connectorRef.current = null;
        }
      };
    }, [modelContext, apiKey]); // Removed onError to prevent re-initialization

    // Handle messages from iframe
    useEffect(() => {
      const handleMessage = (event: globalThis.MessageEvent) => {
        // Verify origin for security
        // In production, you should check event.origin matches your BotDojo domain
        
        const data = event.data;
        
        switch (data.type) {
          case 'ready':
            setIsReady(true);
            onReady?.();
            // Send initial config if provided
            if (config) {
              sendToIframe({
                type: 'update_config',
                config,
              });
            }
            break;

          case 'message_start':
            // Track new message
            currentMessageRef.current = {
              messageId: data.messageId,
              role: data.role,
              content: '',
            };
            
            // Call onMessageStart callback
            onMessageStart?.(data.role, data.messageId);
            
            // If user message, emit immediately (legacy onMessage)
            if (data.role === 'user') {
              onMessage?.(data.role, '', data.messageId);
            } else {
              // Assistant message - set status to running
              setCurrentStatus('running');
              onStatusChange?.('running');
            }
            break;

          case 'token':
            // Accumulate token into current message
            if (currentMessageRef.current && data.tokenUpdate) {
              const token = data.tokenUpdate.token || '';
              currentMessageRef.current.content += token;
              onToken?.(token, data.messageId);
            }
            break;

          case 'step_update':
            // Forward step update
            if (data.step) {
              onStep?.(data.step, data.messageId);
              
              // Check if step has MCP App UI
              if (data.step.canvas) {
                onMcpApp?.(data.step.canvas, data.step.stepId, data.messageId);
              }
            }
            break;

          case 'message_complete':
            // Finalize message
            if (currentMessageRef.current && currentMessageRef.current.messageId === data.messageId) {
              const finalContent = data.content || currentMessageRef.current.content;
              
              // Call onMessageComplete callback
              onMessageComplete?.(data.messageId, finalContent);
              
              // Legacy onMessage callback
              onMessage?.(currentMessageRef.current.role as any, finalContent, data.messageId);
              currentMessageRef.current = null;
              
              setCurrentStatus('completed');
              onStatusChange?.('completed');
              
              // Reset to idle after a brief moment
              setTimeout(() => {
                setCurrentStatus('idle');
                onStatusChange?.('idle');
              }, 100);
            }
            break;

          case 'error':
            setCurrentStatus('error');
            onStatusChange?.('error', data.error);
            if (data.error) {
              onError?.(data.error);
            }
            currentMessageRef.current = null;
            break;

          case 'request_aborted':
            setCurrentStatus('idle');
            onStatusChange?.('idle');
            currentMessageRef.current = null;
            break;

          // MCP App events
          case 'mcp_open_link':
          case 'ui/open-link':
            if (onOpenLink && data.url) {
              onOpenLink(data.url, data.target || '_blank', data.appId || 'unknown');
            }
            break;

          case 'mcp_tool_call':
          case 'tools/call':
            if (onToolCall && data.tool) {
              onToolCall(data.tool, data.params || {}, data.appId || 'unknown');
            }
            break;

          case 'mcp_ui_message':
          case 'ui/message':
            if (onUiMessage) {
              const message = data.message || data.content?.[0]?.text || JSON.stringify(data).slice(0, 120);
              onUiMessage(message, data.params || data, data.appId || 'unknown');
            }
            break;

          default:
            // Ignore unknown message types
            break;
        }
      };

      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }, [config, onStatusChange, onToken, onStep, onMcpApp, onMessageStart, onMessageComplete, onMessage, onReady, onError, onOpenLink, onToolCall, onUiMessage, sendToIframe]);

    return (
      <iframe
        ref={iframeRef}
        src={iframeUrl}
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
          border: 'none',
        }}
        title="BotDojo Headless Chat"
      />
    );
  }
);

HeadlessChat.displayName = 'HeadlessChat';

/**
 * Handle for controlling HeadlessChat imperatively via ref
 */
export interface HeadlessChatHandle {
  /**
   * Send a message to the chat
   * @param input - The flow input object (e.g., { text_input: 'hello' })
   */
  sendMessage: (input: any) => void;

  /**
   * Update chat configuration
   */
  updateConfig: (config: ChatConfig) => void;

  /**
   * Clear chat history
   */
  clearHistory: () => void;

  /**
   * Cancel current flow execution
   */
  cancelExecution: () => void;

  /**
   * Get current status
   */
  getStatus: () => ChatStatus;

  /**
   * Check if iframe is ready
   */
  isReady: () => boolean;
}

