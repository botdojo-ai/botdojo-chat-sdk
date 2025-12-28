import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// Import connector and utilities
import { BotDojoConnector } from './connector';
import { resolveUiCsp, extractUiCspFromResource } from './utils';
import type { ModelContext } from './generated/sdk-types-snapshot';

// CORS config type (previously from sdk-canvas)
export interface ToolCallCorsConfig {
  allowedToolCallOrigins?: string[];
}
import { extractToolHandlers } from './generated/sdk-types-snapshot';
import { PostMessageBridge, createIframeBridge, RPCMessage, RPCMessageError, PostMessageRPCClient, RPCConnection, ConectionOptions } from 'botdojo-rpc';

/**
 * Display modes for BotDojo chat
 */
export type BotDojoChatDisplayMode = 'chat-popup' | 'side-panel' | 'side-push' | 'inline';

/**
 * Popup configuration options
 */
export interface PopupOptions {
    /**
     * Width of the popup
     * @default '400px'
     */
    width?: string;
    /**
     * Height of the popup
     * @default '600px'
     */
    height?: string;
    /**
     * Whether the popup can be resized by the user
     * @default false
     */
    resizable?: boolean;
    /**
     * Minimum width when resizing
     * @default '300px'
     */
    minWidth?: string;
    /**
     * Maximum width when resizing
     * @default 'auto'
     */
    maxWidth?: string;
    /**
     * Minimum height when resizing
     * @default '400px'
     */
    minHeight?: string;
    /**
     * Maximum height when resizing
     * @default 'auto'
     */
    maxHeight?: string;
}

/**
 * Side panel configuration options
 */
export interface SidePanelOptions {
    /**
     * Direction the panel slides in from
     * @default 'right'
     */
    direction?: 'left' | 'right';
    /**
     * Default width of the panel
     * @default '400px'
     */
    defaultWidth?: string;
    /**
     * Whether the panel can be resized by the user
     * @default false
     */
    resizable?: boolean;
    /**
     * Maximum width when resizing
     * @default '800px'
     */
    maxWidth?: string;
    /**
     * Minimum width when resizing
     * @default '300px'
     */
    minWidth?: string;
}

/**
 * Control interface for programmatically controlling the BotDojoChat widget
 */
export interface BotDojoChatControl {
    /**
     * Open the chat widget
     */
    openChat: () => void;
    /**
     * Close the chat widget
     */
    closeChat: () => void;
    /**
     * Send a flow request programmatically
     * - Automatically opens the chat if not already open
     * - Waits for connector to initialize
     * - Sends the request via connector.run()
     * @param body - Request body (string or object)
     * @returns Promise resolving to the flow response
     */
    sendFlowRequest: (body: any) => Promise<any>;
}

/**
 * Props for BotDojoChat component
 */
export interface BotDojoChatProps {
    // Required
    /**
     * BotDojo API key (contains flow ID and configuration)
     */
    apiKey: string;
    
    // Display mode
    /**
     * How the chat should be displayed:
     * - 'chat-popup': Floating button + popup chat (default)
     * - 'side-panel': Slides in from right side (overlays content)
     * - 'side-push': Slides in from right side (pushes content left)
     * - 'inline': Direct iframe embed at current location
     * @default 'chat-popup'
     */
    mode?: BotDojoChatDisplayMode;
    
    /**
     * Configuration options for chat-popup mode
     */
    popupOptions?: PopupOptions;
    
    /**
     * Configuration options for side-panel and side-push modes
     */
    sidePanelOptions?: SidePanelOptions;
    
    // Dimensions
    /**
     * Width of the chat container
     * @default '400px'
     */
    width?: string;
    /**
     * Height of the chat container
     * @default '100%'
     */
    height?: string;
    
    // Styling
    /**
     * Primary accent color
     * @default '#4a3ed4'
     */
    accentColor?: string;
    /**
     * Background color
     * @default '#ffffff'
     */
    backgroundColor?: string;
    /**
     * Theme mode: 'light', 'dark', 'modern-light', or 'modern-dark'
     */
    theme?: 'light' | 'dark' | 'modern-light' | 'modern-dark';
    /**
     * Font size for chat text
     */
    fontSize?: string;
    
    // Flow configuration
    /**
     * Flow version to use
     * @default 'default'
     */
    flowVersion?: string;
    /**
     * Headers to pass to the flow
     */
    flowHeaders?: Record<string, any>;
    
    // Images
    /**
     * URL for user chat icon/image
     */
    userImage?: string;
    /**
     * URL for widget icon (chat button)
     */
    widgetImage?: string;
    /**
     * URL for bot/agent icon/image
     */
    botImage?: string;
    /**
     * URL for voice icon
     */
    voiceIcon?: string;
    /**
     * Hide the bot/agent icon completely
     * @default false
     */
    hideBotIcon?: boolean;
    
    // Session
    /**
     * Start a new session instead of resuming
     * @default false
     */
    newSession?: boolean;
    /**
     * Specific session ID to use
     */
    sessionId?: string;
    /**
     * Prefix for the localStorage session key used to persist the session ID
     * - Defaults to "botdojo-chat-session-id"
     * - Set to avoid collisions when embedding multiple agents
     */
    sessionKeyPrefix?: string;
    /**
     * Override the welcome message shown in the chat widget (supports markdown)
     */
    welcomeMessage?: string;
    
    /**
     * Optional cache key for MCP proxy URL caching.
     * If not provided, uses the MCP App ID.
     */
    cacheKey?: string;
    
    // Focus behavior
    /**
     * Whether to auto-focus the chat input on load
     * @default true for popup/side-panel modes, false for inline mode
     */
    autoFocus?: boolean;
    
    // Permissions
    /**
     * Allow microphone access in iframe
     * @default false
     */
    allowMicrophone?: boolean;
    
    /**
     * Base URL for the chat embed iframe
     * @default 'https://embed.botdojo.com'
     */
    baseUrl?: string;
    
    // Model context (optional - for tool integration)
    /**
     * Model context definition(s) with tools and resources
     * Can be a single ModelContext or an array of ModelContext objects
     * Tools should include `execute` functions directly in their definitions
     */
    modelContext?: ModelContext | ModelContext[];
    
    // Lifecycle callbacks
    /**
     * Called when chat iframe loads
     */
    onLoad?: () => void;
    /**
     * Called when chat is opened (for popup/side-panel modes)
     */
    onOpen?: () => void;
    /**
     * Called when chat is closed (for popup/side-panel modes)
     */
    onClose?: () => void;
    /**
     * Called when connector initializes successfully (if using model context)
     */
    onConnectorInit?: (connector: BotDojoConnector) => void;
    /**
     * Called when connector encounters an error (if using model context)
     */
    onConnectorError?: (error: Error) => void;
    /**
     * Called with control methods for programmatically controlling the chat widget
     * - openChat(): Opens the chat
     * - closeChat(): Closes the chat
     * - sendFlowRequest(body): Sends a flow request programmatically
     */
    onBotDojoChatControl?: (control: BotDojoChatControl) => void;
    
    // Flow event callbacks
    /**
     * Called when chat iframe is ready
     */
    onReady?: () => void;
    /**
     * Called when an error occurs
     */
    onError?: (error: Error, messageId?: string, stepId?: string) => void;
    /**
     * Called when a message starts
     */
    onMessageStart?: (role: 'user' | 'assistant' | 'system', messageId: string) => void;
    /**
     * Called when a message completes
     */
    onMessageComplete?: (messageId: string, content: string) => void;
    /**
     * Called when a step update occurs
     */
    onStepUpdate?: (messageId: string, step: any) => void;
    /**
     * Called when a token is streamed
     */
    onToken?: (messageId: string, tokenUpdate: any) => void;
    /**
     * Called when a session is created
     */
    onSessionCreated?: (sessionId: string) => void;
    /**
     * Called when a session is hydrated with history
     */
    onSessionHydrated?: (sessionId: string, messageCount: number) => void;
    /**
     * Called when a request is aborted
     */
    onRequestAborted?: () => void;
    
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
}

/**
 * BotDojoChat - Single unified React component for embedding BotDojo chat
 * 
 * This component provides a complete solution for embedding BotDojo chat with:
 * - Multiple display modes (popup, side panel, inline)
 * - Optional model context integration for tools and resources
 * - Automatic connector lifecycle management
 * - PostMessage-based communication (no WebSocket needed)
 * 
 * @example
 * Basic usage (no tools):
 * ```tsx
 * <BotDojoChat
 *   apiKey="YOUR_API_KEY"
 *   mode="chat-popup"
 *   accentColor="#4a3ed4"
 * />
 * ```
 * 
 * @example
 * With model context and tools:
 * ```tsx
 * <BotDojoChat
 *   apiKey="YOUR_API_KEY"
 *   mode="chat-popup"
 *   modelContext={{
 *     name: 'myapp',
 *     description: 'My application',
 *     tools: {
 *       get_data: {
 *         description: 'Get data',
 *         parameters: { type: 'object', properties: {} },
 *         execute: async () => ({ data: 'Hello!' })
 *       }
 *     }
 *   }}
 * />
 * ```
 */
export const BotDojoChat: React.FC<BotDojoChatProps> = ({
    apiKey,
    mode = 'chat-popup',
    popupOptions,
    sidePanelOptions,
    width = '400px',
    height = '100%',
    accentColor = '#4a3ed4',
    backgroundColor = '#ffffff',
    theme,
    fontSize,
    flowVersion = 'default',
    flowHeaders,
    userImage,
    widgetImage,
    botImage,
    voiceIcon,
    hideBotIcon = false,
    newSession = false,
    sessionId,
    sessionKeyPrefix,
    welcomeMessage,
    autoFocus,
    allowMicrophone = false,
    baseUrl,
    modelContext,
    onLoad,
    onOpen,
    onClose,
    onConnectorInit,
    onConnectorError,
    onBotDojoChatControl,
    // Flow event handlers
    onReady,
    onError,
    onMessageStart,
    onMessageComplete,
    onStepUpdate,
    onToken,
    onSessionCreated,
    onSessionHydrated,
    onRequestAborted,
    // MCP App event handlers
    onOpenLink,
    onToolCall,
    onUiMessage,
}) => {
    // Merge popup defaults with provided options
    const popupConfig = {
        width: popupOptions?.width || width,
        height: popupOptions?.height || height,
        resizable: popupOptions?.resizable || false,
        minWidth: popupOptions?.minWidth || '300px',
        maxWidth: popupOptions?.maxWidth || 'auto',
        minHeight: popupOptions?.minHeight || '400px',
        maxHeight: popupOptions?.maxHeight || 'auto',
    };

    // Merge side panel defaults with provided options
    const panelConfig = {
        direction: sidePanelOptions?.direction || 'right',
        defaultWidth: sidePanelOptions?.defaultWidth || width,
        resizable: sidePanelOptions?.resizable || false,
        maxWidth: sidePanelOptions?.maxWidth || '800px',
        minWidth: sidePanelOptions?.minWidth || '300px',
    };

    const [isOpen, setIsOpen] = useState(mode === 'inline');
    const [isLoading, setIsLoading] = useState(false);

    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [connector, setConnector] = useState<BotDojoConnector | null>(null);
    const [connectorError, setConnectorError] = useState<Error | null>(null);
    const [isInitializingConnector, setIsInitializingConnector] = useState(false);
    const [panelWidth, setPanelWidth] = useState<number>(parseInt(panelConfig.defaultWidth) || 400);
    const [popupWidth, setPopupWidth] = useState<number>(parseInt(popupConfig.width) || 400);
    const [popupHeight, setPopupHeight] = useState<number>(parseInt(popupConfig.height) || 600);
    const [isResizing, setIsResizing] = useState(false);
    
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const connectionRef = useRef<RPCConnection | null>(null);
    const connectorRef = useRef<BotDojoConnector | null>(null);
    const iframeLoadedRef = useRef<boolean>(false);
    const chatReadyRef = useRef<boolean>(false);
    const chatReadyFiredRef = useRef<boolean>(false); // Track if onReady was already fired
    const resizeStartPos = useRef({ x: 0, y: 0, width: 0, height: 0 });
    
    // Track when modelContext is captured in the RPC effect closure
    // This prevents sandbox-resource requests from failing during session hydration
    // when the effect hasn't run yet
    const modelContextCapturedRef = useRef(false);
    
    // Store latest modelContext in ref so sandbox-resource handlers can access current value
    // (not stale closure value from when effect ran)
    const modelContextRef = useRef(modelContext);
    
    // Keep modelContextRef up to date
    useEffect(() => {
        modelContextRef.current = modelContext;
    }, [modelContext]);

    // Store the initial apiKey for iframe URL - subsequent token refreshes should NOT reload iframe
    const initialApiKeyRef = useRef<string | null>(null);
    if (apiKey && !initialApiKeyRef.current) {
        initialApiKeyRef.current = apiKey;
    }
    // The apiKey to use for iframe URL (stable after first set)
    const iframeApiKey = initialApiKeyRef.current || apiKey;

    // Store current apiKey in ref for RPC getToken callback (avoids stale closure)
    const apiKeyRef = useRef(apiKey);
    apiKeyRef.current = apiKey;
    
    // Store event handlers in refs to avoid re-renders
    const eventHandlersRef = useRef({
        onReady,
        onError,
        onMessageStart,
        onMessageComplete,
        onStepUpdate,
        onToken,
        onSessionCreated,
        onSessionHydrated,
        onRequestAborted,
        // MCP App handlers
        onOpenLink,
        onToolCall,
        onUiMessage,
    });
    
    // Update event handlers ref when props change
    useEffect(() => {
        eventHandlersRef.current = {
            onReady,
            onError,
            onMessageStart,
            onMessageComplete,
            onStepUpdate,
            onToken,
            onSessionCreated,
            onSessionHydrated,
            onRequestAborted,
            onOpenLink,
            onToolCall,
            onUiMessage,
        };
    }, [onReady, onError, onMessageStart, onMessageComplete, onStepUpdate, onToken,
        onSessionCreated, onSessionHydrated, onRequestAborted, onOpenLink,
        onToolCall, onUiMessage]);

    // Track RPC ready state
    const rpcReadyRef = useRef(false);
    
    // Force update counter to trigger RPC effect immediately after early chat_ready
    const [rpcTrigger, setRpcTrigger] = useState(0);
    
    // Early message listener to capture chat_ready before RPC connection is set up
    // This handles the race condition where the iframe sends messages before
    // the SDK has finished initializing its RPC handlers (common on cached refreshes)
    useEffect(() => {
        const handleEarlyMessages = (event: MessageEvent) => {
            const data = event.data;
            if (data?.type !== 'botdojo-rpc') return;
            
            const payload = data.payload;
            
            // Handle chat_ready signal
            if (payload?.functionName === 'chat_ready') {
                console.log('[BotDojoChat] Early listener captured chat_ready');
                chatReadyRef.current = true;
                
                // If we received chat_ready, the iframe is definitely loaded
                // This handles the case where onload fired before React attached the handler
                if (!iframeLoadedRef.current) {
                    console.log('[BotDojoChat] Setting iframeLoaded=true (inferred from chat_ready)');
                    iframeLoadedRef.current = true;
                    setIframeLoaded(true);
                    // Also trigger RPC effect immediately
                    setRpcTrigger(t => t + 1);
                }
            }
        };
        
        window.addEventListener('message', handleEarlyMessages);
        return () => window.removeEventListener('message', handleEarlyMessages);
    }, []); // Empty deps - run once on mount

    // Determine if we need a connector (only if modelContext is provided with real content)
    // Check if modelContext has actual content (not just an empty object)
    const hasModelContextContent = useMemo(() => {
        if (!modelContext) return false;
        const contexts = Array.isArray(modelContext) ? modelContext : [modelContext];
        return contexts.some(ctx => {
            // Check if context has tools, prompts, or resources
            const hasTools = ctx.tools && (
                Array.isArray(ctx.tools) ? ctx.tools.length > 0 : Object.keys(ctx.tools).length > 0
            );
            const hasPrompts = ctx.prompts && (
                Array.isArray(ctx.prompts) ? ctx.prompts.length > 0 : Object.keys(ctx.prompts).length > 0
            );
            const hasResources = ctx.resources && (
                Array.isArray(ctx.resources) ? ctx.resources.length > 0 : Object.keys(ctx.resources).length > 0
            );
            return hasTools || hasPrompts || hasResources || !!ctx.name;
        });
    }, [modelContext]);
    const needsConnector = hasModelContextContent;

    // Get base URL for iframe (defaults to production, can be overridden)
    const getBaseUrl = useCallback(() => {
        // If baseUrl prop is provided, use it
        if (baseUrl) {
            return baseUrl;
        }
        // Default to production embed server
        return 'https://embed.botdojo.com';
    }, [baseUrl]);

    // Detect if any event callbacks are provided (used to enable event forwarding)
    const hasEventCallbacks = !!(
        onReady || onError || onMessageStart || onMessageComplete ||
        onStepUpdate || onToken || onSessionCreated || onSessionHydrated ||
        onRequestAborted
    );
    
    // Default autoFocus based on mode: true for popup/panel, false for inline
    const effectiveAutoFocus = autoFocus ?? (mode !== 'inline');
    
    // Debug: log callback detection
    console.log('[BotDojoChat] hasEventCallbacks:', hasEventCallbacks, {
        onReady: !!onReady,
        onToken: !!onToken,
        onMessageStart: !!onMessageStart,
    });

    // Build iframe URL ONCE - never changes after initial creation to prevent iframe reload
    // All property changes after mount are communicated via postMessage, not URL changes
    const initialIframeUrlRef = useRef<string | null>(null);
    
    // Build URL only once when iframeApiKey becomes available
    if (iframeApiKey && !initialIframeUrlRef.current) {
        try {
            const base = `${getBaseUrl()}/embed/chat?key=${encodeURIComponent(iframeApiKey)}`;
            const url = new URL(base);
            
            // Add query parameters from initial props
            url.searchParams.set('accent-color', accentColor);
            url.searchParams.set('flow-version', flowVersion);
            // Avoid adding embedded-source-url to keep iframe src stable between SSR and CSR
            
            if (flowHeaders) url.searchParams.set('flow-headers', JSON.stringify(flowHeaders));
            if (botImage) url.searchParams.set('bot-image', botImage);
            if (userImage) url.searchParams.set('user-image', userImage);
            if (voiceIcon) url.searchParams.set('voice-icon', voiceIcon);
            if (hideBotIcon) url.searchParams.set('hide-bot-icon', 'true');
            if (sessionId) url.searchParams.set('session-id', sessionId);
            if (sessionKeyPrefix) {
                url.searchParams.set('session-key-prefix', sessionKeyPrefix);
                // Alias for compatibility with requested naming
                url.searchParams.set('agent-key', sessionKeyPrefix);
            }
            if (welcomeMessage) url.searchParams.set('welcome-message', welcomeMessage);
            if (fontSize) url.searchParams.set('font-size', fontSize);
            if (backgroundColor) url.searchParams.set('background-color', backgroundColor);
            if (theme) url.searchParams.set('theme', theme);
            if (newSession) url.searchParams.set('new-session', 'true');
            
            // Pass autoFocus setting to iframe (only when disabled, since true is the default inside)
            if (!effectiveAutoFocus) {
                url.searchParams.set('auto-focus', 'false');
            }
            
            // PostMessage transport is always enabled for BotDojoChat (always embedded in iframe)
            url.searchParams.set('transport', 'postmessage');
            url.searchParams.set('transport-mode', 'iframe');
            
            // Enable event forwarding when callbacks are provided
            // This tells the iframe to send events via postMessage to the parent
            if (hasEventCallbacks) {
                url.searchParams.set('forward-events', 'true');
                console.log('[BotDojoChat] Added forward-events=true to iframe URL');
            }
            
            initialIframeUrlRef.current = url.toString();
            console.log('[BotDojoChat] iframeUrl (set once):', initialIframeUrlRef.current);
        } catch (error) {
            console.warn('[BotDojoChat] Error building iframe URL:', error);
            initialIframeUrlRef.current = `${getBaseUrl()}/embed/chat?key=${encodeURIComponent(iframeApiKey)}`;
        }
    }
    
    // Always use the initial URL - never changes after first set
    const iframeUrl = initialIframeUrlRef.current;

    // Track if connector has been initialized (to prevent recreation on apiKey changes)
    const connectorInitializedRef = useRef(false);

    // Initialize connector if needed (only once when apiKey first becomes available)
    useEffect(() => {
        // Skip if connector already initialized or if we don't need one
        if (connectorInitializedRef.current || !needsConnector || !apiKey) {
            return;
        }

        let mounted = true;
        let currentConnector: BotDojoConnector | null = null;

        const initConnector = async () => {
            try {
                setIsInitializingConnector(true);
                setConnectorError(null);

                console.log('[BotDojoChat] Initializing connector with postMessage transport...');

                // Don't extract tool handlers - let BotDojoConnector register tools from modelContext directly
                // This preserves canvasTemplate metadata which is needed for automatic ToolExecutionContext injection
                // The connector's registerCallbacks() will register tools from modelContext.tools with full metadata
                
                // BotDojoChat always uses postMessage transport for browser embedding
                currentConnector = new BotDojoConnector({
                    apiKey,
                    accountId: 'embedded',
                    projectId: 'embedded',
                    flowId: 'embedded',
                    modelContext,
                    // Don't pass toolCalls - tools will be registered from modelContext with canvas metadata preserved
                    transport: 'postmessage',
                    // CORS is extracted from modelContext.cors by the connector
                });

                connectorRef.current = currentConnector;

                await currentConnector.init();

                if (!mounted) {
                    await currentConnector.close();
                    return;
                }

                connectorInitializedRef.current = true; // Mark as initialized
                setConnector(currentConnector);
                setIsInitializingConnector(false);
                onConnectorInit?.(currentConnector);

                console.log('[BotDojoChat] Connector initialized successfully');
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                console.error('[BotDojoChat] Failed to initialize connector:', error);
                
                if (mounted) {
                    setConnectorError(error);
                    setIsInitializingConnector(false);
                    onConnectorError?.(error);
                }
                
                if (currentConnector) {
                    try {
                        await currentConnector.close();
                    } catch (closeErr) {
                        console.warn('[BotDojoChat] Error during cleanup:', closeErr);
                    }
                }
            }
        };

        initConnector();

        return () => {
            mounted = false;
            // Don't close connector on apiKey changes - only track mounted state
            // The connector will be closed when component actually unmounts (see separate unmount effect)
        };
    }, [needsConnector, apiKey]); // apiKey in deps so effect runs when token first loads

    // Separate effect to handle unmount cleanup only
    useEffect(() => {
        return () => {
            // This cleanup only runs on actual component unmount
            if (!connectorInitializedRef.current) return;
            
            const connectorToClose = connectorRef.current;
            if (connectorToClose) {
                connectorInitializedRef.current = false;
                connectorToClose.close().catch((err) => {
                    console.warn('[BotDojoChat] Error during unmount cleanup:', err);
                });
                connectorRef.current = null;
            }
        };
    }, []); // Empty deps = only runs on unmount

    

    // Update model context when it changes (V2 handles tool callbacks internally)
    useEffect(() => {
        if (!connector) return;

        if (modelContext) {
            connector.setModelContext(modelContext);
            console.log('[BotDojoChat] Updated model context');
        }
    }, [connector, modelContext]);

    // Expose control methods (memoized to prevent recreating on every render)
    const controlMethods = React.useMemo<BotDojoChatControl>(() => ({
        openChat: () => {
            if (mode === 'inline') {
                console.warn('[BotDojoChat] openChat() is not applicable in inline mode');
                return;
            }
            setIsOpen(true);
            onOpen?.();
        },
        
        closeChat: () => {
            if (mode === 'inline') {
                console.warn('[BotDojoChat] closeChat() is not applicable in inline mode');
                return;
            }
            setIsOpen(false);
            onClose?.();
        },
        
        sendFlowRequest: async (body: any) => {
            console.log('[BotDojoChat] sendFlowRequest called with body:', body);
            
            // Open chat if not already open
            setIsOpen(prev => {
                if (mode !== 'inline' && !prev) {
                    console.log('[BotDojoChat] Opening chat for flow request');
                    onOpen?.();
                    return true;
                }
                return prev;
            });
            
            // Wait for iframe to load (max 10 seconds)
            // Also check contentWindow as fallback - if URL didn't change, onLoad won't fire again
            console.log('[BotDojoChat] Waiting for iframe to load...');
            let iframeRetries = 0;
            const maxIframeRetries = 100; // 10 seconds max wait
            
            const isIframeReady = () => {
                // Check ref first, then fallback to checking contentWindow
                if (iframeLoadedRef.current) return true;
                if (iframeRef.current?.contentWindow) {
                    // iframe is loaded but onLoad didn't fire (URL didn't change)
                    console.log('[BotDojoChat] Iframe already loaded (contentWindow available)');
                    iframeLoadedRef.current = true;
                    // Also trigger state update so RPC initialization useEffect runs
                    setIframeLoaded(true);
                    return true;
                }
                return false;
            };
            
            while (!isIframeReady() && iframeRetries < maxIframeRetries) {
                await new Promise(resolve => setTimeout(resolve, 100));
                iframeRetries++;
            }
            
            if (!iframeLoadedRef.current) {
                throw new Error('Iframe failed to load after 10 seconds');
            }
            
            console.log('[BotDojoChat] ✅ Iframe loaded');
            
            // Wait for chat_ready signal (max 15 seconds)
            // Also check if connection is already established as fallback
            console.log('[BotDojoChat] Waiting for chat_ready signal...');
            let readyRetries = 0;
            const maxReadyRetries = 150; // 15 seconds max wait
            
            const isChatReady = () => {
                if (chatReadyRef.current) return true;
                // Fallback: if RPC connection is established, chat is ready
                // (chat_ready signal may have been sent before we started listening)
                if (connectionRef.current) {
                    console.log('[BotDojoChat] Chat ready (RPC connection established)');
                    chatReadyRef.current = true;
                    return true;
                }
                return false;
            };
            
            while (!isChatReady() && readyRetries < maxReadyRetries) {
                await new Promise(resolve => setTimeout(resolve, 100));
                readyRetries++;
            }
            
            if (!chatReadyRef.current) {
                throw new Error('Chat failed to send ready signal after 15 seconds');
            }
            
            console.log('[BotDojoChat] ✅ Chat ready signal received');
            
            // Wait for RPC connection to initialize (max 15 seconds)
            // This is critical - the connection must be ready before sending
            console.log('[BotDojoChat] Waiting for RPC connection to initialize...');
            let connectionRetries = 0;
            const maxConnectionRetries = 150; // 15 seconds max wait
            
            while (!connectionRef.current && connectionRetries < maxConnectionRetries) {
                await new Promise(resolve => setTimeout(resolve, 100));
                connectionRetries++;
                if (connectionRetries % 10 === 0) {
                    console.log(`[BotDojoChat] Still waiting for RPC connection... (${connectionRetries * 100}ms)`);
                }
            }
            
            if (!connectionRef.current) {
                throw new Error('RPC connection failed to initialize after 15 seconds. The connection initialization may have failed.');
            }
            
            console.log('[BotDojoChat] ✅ RPC connection ready, sending executeFlowRun');
            
            // Use RPCConnection to send request (automatic timeout and response matching)
            // The parent will block here until the message is sent and response received
            return await connectionRef.current.sendRequest(
                'agent_host',
                'executeFlowRun',
                [body],
                60000 // 60 second timeout for the flow execution
            );
        }
    }), [mode, needsConnector, onOpen, onClose]);

    // Call onBotDojoChatControl only once when it's first available
    useEffect(() => {
        if (!onBotDojoChatControl) return;
        
        onBotDojoChatControl(controlMethods);
        console.log('[BotDojoChat] Control methods exposed');
        
        // Only run once when onBotDojoChatControl is first provided
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onBotDojoChatControl]);
    
    // Listen for flow events and canvas events from chat iframe
    useEffect(() => {
        if (!iframeRef.current) {
            return;
        }
        
        const handleMessage = (event: MessageEvent) => {
            const handlers = eventHandlersRef.current;
            
            // Handle MCP Apps JSON-RPC payloads from canvas iframes
            if (event.data?.jsonrpc === '2.0' && event.data.method) {
                const { method, params, id } = event.data;
                const reply = (payload: any) => {
                    if (id === undefined) return;
                    (event.source as WindowProxy | null)?.postMessage({ jsonrpc: '2.0', id, ...payload }, event.origin || '*');
                };

                const sendNotification = (m: string, p?: any) => {
                    (event.source as WindowProxy | null)?.postMessage({ jsonrpc: '2.0', method: m, params: p }, event.origin || '*');
                };

                const withHandlers = (fn: () => Promise<any> | any) => {
                    try {
                        return Promise.resolve(fn());
                    } catch (err) {
                        return Promise.reject(err);
                    }
                };

                const handle = async () => {
                    try {
                        switch (method) {
                            case 'ui/initialize': {
                                const result = {
                                    hostInfo: { name: 'BotDojo Chat Host', version: '1.0.0' },
                                    capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html+mcp', 'text/html;profile=mcp-app'] } } },
                                    hostContext: {},
                                };
                                reply({ result });
                                sendNotification('ui/notifications/initialized', {});
                                return;
                            }
                            case 'ui/open-link': {
                                const url = params?.url;
                                if (url && handlers.onOpenLink) {
                                    withHandlers(() => handlers.onOpenLink!(url, params?.target || '_blank', params?.canvasId || 'unknown'));
                                }
                                reply({ result: { ok: true } });
                                return;
                            }
                            case 'ui/message': {
                                console.log('[MCP Persist Debug] Host received ui/message JSON-RPC', { params });
                                if (handlers.onUiMessage) {
                                    const message = params?.content?.[0]?.text || JSON.stringify(params).slice(0, 120);
                                    await withHandlers(() =>
                                        handlers.onUiMessage!(message, params, params?.canvasId || 'unknown')
                                    );
                                }
                                reply({ result: { ok: true } });
                                return;
                            }
                            case 'tools/call': {
                                const toolName = params?.tool || params?.name;
                                if (toolName && handlers.onToolCall) {
                                    const res = await withHandlers(() =>
                                        handlers.onToolCall!(toolName, params?.params || params?.arguments || {}, params?.canvasId || 'unknown')
                                    );
                                    reply({ result: res ?? { ok: true } });
                                    return;
                                }
                                reply({ result: { ok: false, ignored: true } });
                                return;
                            }
                            case 'resources/read': {
                                const uri = params?.uri;
                                const resourceParams = params?.params || (params?.mimeType ? { mimeType: params.mimeType } : undefined);
                                const metadataOnly = params?.metadataOnly ?? params?.onlyMetadata ?? false;
                                const connector = connectorRef.current;
                                if (!uri) {
                                    reply({ error: { code: -32602, message: 'resources/read missing uri' } });
                                    return;
                                }
                                const rpcConnection = connector?.getConnection?.();
                                if (rpcConnection?.sendRequest) {
                                    try {
                                        const result = await rpcConnection.sendRequest(
                                            'agent_host',
                                            'getResource',
                                            [uri, resourceParams, metadataOnly],
                                            5000
                                        );
                                        reply({ result });
                                    } catch (err: any) {
                                        reply({ error: { code: -32001, message: err?.message || 'resources/read failed' } });
                                    }
                                    return;
                                }
                                reply({ error: { code: -32601, message: 'resources/read not supported in host' } });
                                return;
                            }
                            default:
                                reply({ result: { ok: true, ignored: true } });
                        }
                    } catch (err: any) {
                        reply({ error: { code: -32000, message: err?.message || 'Host error' } });
                    }
                };

                void handle();
                return;
            }
            
            // Verify origin for security (only from our baseUrl)
            try {
                const eventOrigin = new URL(event.origin).origin;
                const expectedOrigin = new URL(getBaseUrl()).origin;
                if (eventOrigin !== expectedOrigin) {
                    return;
                }
            } catch (e) {
                console.error('[BotDojoChat] Invalid origin:', event.origin);
                return;
            }
            
            const data = event.data;
            
            // Skip if not our event type or if it's an RPC message (handled by connector)
            if (!data || !data.type || data.type === 'botdojo-rpc') {
                return;
            }
            
            // Handle flow events - only call if handler is registered, with error handling
            // NOTE: 'ready' postMessage is NOT used for onReady callback
            // onReady is fired when 'chat_ready' RPC signal is received (ensures sendFlowRequest works)
            switch (data.type) {
                case 'error':
                    if (handlers.onError) {
                        try {
                            const error = new Error(data.error || 'Unknown error');
                            handlers.onError(error, data.messageId, data.stepId);
                        } catch (handlerError) {
                            console.error('[BotDojoChat] Error in onError handler:', handlerError);
                        }
                    }
                    break;
                    
                case 'message_start':
                    if (handlers.onMessageStart) {
                        try {
                            handlers.onMessageStart(data.role, data.messageId);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onMessageStart handler:', error);
                        }
                    }
                    break;
                    
                case 'message_complete':
                    if (handlers.onMessageComplete) {
                        try {
                            handlers.onMessageComplete(data.messageId, data.content);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onMessageComplete handler:', error);
                        }
                    }
                    break;
                    
                case 'step_update':
                    if (handlers.onStepUpdate) {
                        try {
                            handlers.onStepUpdate(data.messageId, data.step);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onStepUpdate handler:', error);
                        }
                    }
                    break;
                    
                case 'token':
                    if (handlers.onToken) {
                        try {
                            handlers.onToken(data.messageId, data.tokenUpdate);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onToken handler:', error);
                        }
                    }
                    break;
                    
                case 'session_created':
                    if (handlers.onSessionCreated) {
                        try {
                            handlers.onSessionCreated(data.sessionId);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onSessionCreated handler:', error);
                        }
                    }
                    break;
                    
                case 'session_hydrated':
                    if (handlers.onSessionHydrated) {
                        try {
                            handlers.onSessionHydrated(data.sessionId, data.messageCount);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onSessionHydrated handler:', error);
                        }
                    }
                    break;
                    
                case 'request_aborted':
                    if (handlers.onRequestAborted) {
                        try {
                            handlers.onRequestAborted();
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onRequestAborted handler:', error);
                        }
                    }
                    break;
                    
                // Handle canvas events from canvas iframes (forwarded by chat iframe)
                case 'canvas_intent':
                case 'intent':
                    const intent = data.intent || data.payload?.intent;
                    const intentParams = data.params || data.payload?.params || {};
                    const intentCanvasId = data.canvasId || data.payload?.canvasId;
                    
                    if (intentCanvasId && intent && handlers.onToolCall) {
                        try {
                            handlers.onToolCall(intent, intentParams, intentCanvasId);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onToolCall handler:', error);
                        }
                    }
                    break;
                    
                case 'canvas_notify':
                case 'notify':
                    const notifyMessage = data.message || data.payload?.message;
                    const notifyParams = data.params || data.payload?.params || {};
                    const notifyCanvasId = data.canvasId || data.payload?.canvasId;
                    
                    if (notifyCanvasId && notifyMessage && handlers.onUiMessage) {
                        try {
                            handlers.onUiMessage(notifyMessage, notifyParams, notifyCanvasId);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onUiMessage handler:', error);
                        }
                    }
                    break;
                    
                case 'canvas_prompt':
                case 'prompt':
                    const promptText = data.prompt || data.payload?.prompt;
                    const promptParams = data.params || data.payload?.params || {};
                    const promptCanvasId = data.canvasId || data.payload?.canvasId;
                    
                    if (promptCanvasId && promptText && handlers.onUiMessage) {
                        try {
                            handlers.onUiMessage(promptText, promptParams, promptCanvasId);
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onUiMessage handler:', error);
                        }
                    }
                    break;
                    
                case 'canvas_link':
                case 'link':
                    const linkUrl = data.url || data.payload?.url;
                    const linkTarget = data.target || data.payload?.target || '_blank';
                    const linkCanvasId = data.canvasId || data.payload?.canvasId;
                    
                    if (linkUrl && handlers.onOpenLink) {
                        try {
                            handlers.onOpenLink(linkUrl, linkTarget, linkCanvasId || 'unknown');
                        } catch (error) {
                            console.error('[BotDojoChat] Error in onOpenLink handler:', error);
                        }
                    }
                    break;
                    
                default:
                    // Ignore unknown event types silently
                    break;
            }
        };
        
        window.addEventListener('message', handleMessage);
        
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [getBaseUrl]); // Only depend on getBaseUrl (refs handle the rest)

    // Initialize postMessage bridge when iframe loads (connector is optional)
    // Use ref instead of state to avoid re-render delay on cached refreshes
    useEffect(() => {
        if (!iframeRef.current?.contentWindow) {
            return;
        }
        // Check both state and ref - ref catches early chat_ready before state updates
        if (!iframeLoaded && !iframeLoadedRef.current) {
            return;
        }

        const initializeConnection = async () => {
            // Initialize connector's PostMessage target first (if connector exists)
            if (connector && connector.updatePostMessageTarget) {
                console.log('[BotDojoChat] Initializing connector PostMessage target');
                await connector.updatePostMessageTarget(iframeRef.current!.contentWindow!);
            }

            try {
                console.log('[BotDojoChat] Creating PostMessageRPCClient + RPCConnection');
                
                // Extract CORS config from modelContext (use ref to get latest value)
                // botdojoChatDomain will come from flow settings via chat iframe
                const currentModelContext = modelContextRef.current;
                const firstContext = currentModelContext ? (Array.isArray(currentModelContext) ? currentModelContext[0] : currentModelContext) : null;
                const corsConfig = firstContext?.cors ? {
                    allowedToolCallOrigins: firstContext.cors.allowedToolCallOrigins
                    // botdojoChatDomain is configured server-side, not by SDK users
                } : undefined;
                
                // Create PostMessageRPCClient (implements IRPC_Client)
                const client = new PostMessageRPCClient(
                    iframeRef.current!.contentWindow!,
                    {
                        getToken: async () => apiKeyRef.current,  // Use ref to always get current token
                        clientId: 'chat_embed_parent',
                        defaultDestinationId: 'agent_host',
                        baseChannel: 'chat_embed',
                    },
                    '*', // targetOrigin
                    true,  // debug
                    'parent', // role - this is the parent SDK
                    corsConfig
                );
                
                console.log('[BotDojoChat] PostMessage connection created with CORS config:', corsConfig);
                
                // Wrap in RPCConnection for automatic request/response handling
                const connection = new RPCConnection(
                    client,
                    new ConectionOptions(),
                    async (msg: RPCMessage) => {
                        // Accept tool calls from agent (origin='server', trusted)
                        // Router sets this when proxying agent → parent tool calls
                        if (msg.origin === 'server') {
                            // Agent tool call, always allowed
                            console.log(`[BotDojoChat] Agent tool call (origin=server): ${msg.functionName}`);
                            // Handle tool call - this will be processed by the connector or model context
                            // Fall through to normal handling
                        }

                        // Handle incoming messages not covered by registered callbacks
                        console.log('[BotDojoChat] Unhandled message:', msg.functionName);

                        // Handle chat_ready signal - this is the TRUE ready state
                        if (msg.functionName === 'chat_ready') {
                            console.log('[BotDojoChat] Chat is ready for flow requests');
                            chatReadyRef.current = true;

                            // Fire onReady if not already fired by early listener fallback
                            if (!chatReadyFiredRef.current) {
                                chatReadyFiredRef.current = true;
                                const handlers = eventHandlersRef.current;
                                if (handlers.onReady) {
                                    try { handlers.onReady(); } catch (e) { console.error('[BotDojoChat] Error in onReady:', e); }
                                }
                            }
                            return;
                        }
                        
                        // Handle chat event forwarding from Session.tsx via BotDojoCanvasHost
                        // These events are sent via forwardChatEventToParent when forward-events=true
                        const handlers = eventHandlersRef.current;
                        const eventData = msg.data?.[0]; // Data is wrapped in array by RPC
                        
                        // NOTE: 'ready' event via RPC is NOT used for onReady callback
                        // onReady is fired when 'chat_ready' signal is received (see above)
                        // This ensures sendFlowRequest works immediately after onReady
                        
                        if (msg.functionName === 'error' && handlers.onError) {
                            console.log('[BotDojoChat] Received error event via RPC:', eventData);
                            try {
                                const error = new Error(eventData?.error || 'Unknown error');
                                handlers.onError(error, eventData?.messageId, eventData?.stepId);
                            } catch (e) { console.error('[BotDojoChat] Error in onError:', e); }
                            return;
                        }
                        
                        if (msg.functionName === 'message_start' && handlers.onMessageStart) {
                            console.log('[BotDojoChat] Received message_start event via RPC:', eventData);
                            try { handlers.onMessageStart(eventData?.role, eventData?.messageId); } catch (e) { console.error('[BotDojoChat] Error in onMessageStart:', e); }
                            return;
                        }
                        
                        if (msg.functionName === 'message_complete' && handlers.onMessageComplete) {
                            console.log('[BotDojoChat] Received message_complete event via RPC:', eventData);
                            try { handlers.onMessageComplete(eventData?.messageId, eventData?.content); } catch (e) { console.error('[BotDojoChat] Error in onMessageComplete:', e); }
                            return;
                        }
                        
                        if (msg.functionName === 'step_update' && handlers.onStepUpdate) {
                            console.log('[BotDojoChat] Received step_update event via RPC:', eventData);
                            try { handlers.onStepUpdate(eventData?.messageId, eventData?.step); } catch (e) { console.error('[BotDojoChat] Error in onStepUpdate:', e); }
                            return;
                        }
                        
                        if (msg.functionName === 'token' && handlers.onToken) {
                            console.log('[BotDojoChat] Received token event via RPC:', eventData);
                            try { handlers.onToken(eventData?.messageId, eventData?.tokenUpdate); } catch (e) { console.error('[BotDojoChat] Error in onToken:', e); }
                            return;
                        }
                        
                        if (msg.functionName === 'session_created' && handlers.onSessionCreated) {
                            console.log('[BotDojoChat] Received session_created event via RPC:', eventData);
                            try { handlers.onSessionCreated(eventData?.sessionId); } catch (e) { console.error('[BotDojoChat] Error in onSessionCreated:', e); }
                            return;
                        }
                        
                        if (msg.functionName === 'session_hydrated' && handlers.onSessionHydrated) {
                            console.log('[BotDojoChat] Received session_hydrated event via RPC:', eventData);
                            try { handlers.onSessionHydrated(eventData?.sessionId, eventData?.messageCount); } catch (e) { console.error('[BotDojoChat] Error in onSessionHydrated:', e); }
                            return;
                        }
                        
                        if (msg.functionName === 'request_aborted' && handlers.onRequestAborted) {
                            console.log('[BotDojoChat] Received request_aborted event via RPC');
                            try { handlers.onRequestAborted(); } catch (e) { console.error('[BotDojoChat] Error in onRequestAborted:', e); }
                            return;
                        }
                        
                        // Handle canvas action events (link, intent, notify, prompt)
                        // These are forwarded from BotDojoCanvasHost when canvases send actions
                        if (msg.functionName === 'canvas_event') {
                            const canvasEvent = eventData;
                            console.log('[BotDojoChat] Received canvas_event via RPC:', canvasEvent);
                            const looksLikeHtml = (value?: any) => {
                                if (!value || typeof value !== 'string') return false;
                                const trimmed = value.trim();
                                if (!trimmed.startsWith('<')) return false;
                                return /<\/?(html|head|body|div|span|script|style)/i.test(trimmed);
                            };
                            const extractHtmlFromResource = (resource: any): string | undefined => {
                                if (!resource) return undefined;
                                if (typeof resource.html === 'string') return resource.html;
                                if (typeof resource.text === 'string' && looksLikeHtml(resource.text)) return resource.text;
                                if (typeof resource.data === 'string' && looksLikeHtml(resource.data)) return resource.data;
                                const contents = (resource as any)?.contents || (resource as any)?.content || (resource as any)?.data;
                                const list = Array.isArray(contents) ? contents : contents ? [contents] : [];
                                const match = list.find((item: any) => typeof item?.html === 'string' || looksLikeHtml(item?.text) || typeof item?.data === 'string');
                                if (match) {
                                    return match.html || (looksLikeHtml(match.text) ? match.text : typeof match.data === 'string' ? match.data : undefined);
                                }
                                return undefined;
                            };

                            if (canvasEvent?.type === 'sandbox-resource') {
                                const uri = canvasEvent.resource;
                                const mimeType = canvasEvent.mimeType;
                                const connection = connectorRef.current?.getConnection?.();
                                console.log('[BotDojoChat] sandbox-resource request for URI:', uri);
                                console.log('[BotDojoChat] sandbox-resource: connection available?', !!connection?.sendRequest);

                                const matchesTemplate = (template: string, value: string): boolean => {
                                    if (!template || !value) return false;
                                    const escaped = template.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
                                    const regex = new RegExp('^' + escaped.replace(/\\{[^}]+\\}/g, '[^/]+') + '$');
                                    return regex.test(value);
                                };
                                const extractTemplateParams = (template: string, value: string): Record<string, string> => {
                                    const params: Record<string, string> = {};
                                    const tmplParts = template.split('/');
                                    const valParts = value.split('/');
                                    tmplParts.forEach((part, idx) => {
                                        if (part.startsWith('{') && part.endsWith('}')) {
                                            params[part.slice(1, -1)] = valParts[idx];
                                        }
                                    });
                                    return params;
                                };

                                const tryConnector = async (): Promise<{ html?: string; csp?: string; sandbox?: string; error?: string }> => {
                                    if (!uri || !connection?.sendRequest) return { error: 'missing connection' };

                                    // First discover contexts to pick the matching MCP
                                    let contexts: any[] | null = null;
                                    try {
                                        contexts = await connection.sendRequest('agent_host', 'getModelContexts', [], 4000);
                                    } catch (e) {
                                        console.warn('[BotDojoChat] sandbox-resource could not list contexts', e);
                                    }

                                    const hasMatch = (ctx: any) =>
                                        (ctx?.resources || []).some(
                                            (r: any) =>
                                                r?.uri === uri ||
                                                (r?.uriTemplate && matchesTemplate(r.uriTemplate, uri))
                                        );

                                    const matchingCtx = contexts?.find(hasMatch);
                                    if (!matchingCtx && !contexts) {
                                        console.warn('[BotDojoChat] sandbox-resource: no contexts available, trying direct getResource');
                                    } else if (!matchingCtx) {
                                        console.warn('[BotDojoChat] sandbox-resource: no matching context found for', uri);
                                    }

                                    try {
                                        const result = await connection.sendRequest(
                                            'agent_host',
                                            'getResource',
                                            [uri, mimeType ? { mimeType } : undefined, false],
                                            7000
                                        );
                                        const html = extractHtmlFromResource(result);
                                        if (!html) {
                                            return { error: 'no html from agent_host' };
                                        }
                                        const cspMeta = extractUiCspFromResource(result);
                                        const resolvedCsp = resolveUiCsp(cspMeta);
                                        return {
                                            html,
                                            csp: resolvedCsp.csp,
                                            sandbox: canvasEvent.sandbox || resolvedCsp.sandbox,
                                        };
                                    } catch (e: any) {
                                        console.error('[BotDojoChat] sandbox-resource connector resolver error', e);
                                        return { error: e?.message || 'connector error' };
                                    }
                                };

                                const tryModelContext = async (): Promise<{ html?: string; csp?: string; sandbox?: string; error?: string }> => {
                                    // Wait for modelContext to be available (max 3s)
                                    // Use ref to get latest value, not stale closure value
                                    // This handles race condition where sandbox-resource requests
                                    // arrive during session hydration before modelContext is ready
                                    let waited = 0;
                                    const maxWait = 3000;
                                    while (waited < maxWait) {
                                        const currentContext = modelContextRef.current;
                                        if (currentContext) {
                                            const contexts = Array.isArray(currentContext) ? currentContext : [currentContext];
                                            const allResources = contexts.flatMap((ctx) => ctx.resources || []);
                                            // Check if any resource matches the URI we're looking for
                                            const hasMatchingResource = allResources.some((r: any) => {
                                                return r?.uri === uri || 
                                                    (r?.uriTemplate && matchesTemplate(r.uriTemplate, uri));
                                            });
                                            if (hasMatchingResource) {
                                                console.log('[BotDojoChat] tryModelContext: Found matching resource after', waited, 'ms');
                                                break;
                                            }
                                        }
                                        await new Promise(r => setTimeout(r, 50));
                                        waited += 50;
                                    }
                                    
                                    // Get latest modelContext from ref
                                    const currentModelContext = modelContextRef.current;
                                    if (!uri || !currentModelContext) return { error: 'no modelContext' };
                                    const contexts = Array.isArray(currentModelContext) ? currentModelContext : [currentModelContext];
                                    const allResources = contexts.flatMap((ctx) => ctx.resources || []);
                                    console.log('[BotDojoChat] tryModelContext: Searching', allResources.length, 'resources for URI:', uri);
                                    allResources.forEach((r: any, i: number) => {
                                        console.log(`[BotDojoChat] tryModelContext: Resource[${i}].uri =`, r.uri);
                                    });
                                    const match = allResources
                                        .find((r) => {
                                            const candidate = r as any;
                                            const uriMatch = typeof candidate?.uri === 'string' && candidate.uri === uri;
                                            const templateMatch =
                                                'uriTemplate' in candidate &&
                                                candidate.uriTemplate &&
                                                matchesTemplate(candidate.uriTemplate as any, uri);
                                            console.log('[BotDojoChat] tryModelContext: Checking', candidate?.uri, '=== ', uri, '?', uriMatch);
                                            return uriMatch || templateMatch;
                                        });
                                    if (!match) {
                                        console.log('[BotDojoChat] tryModelContext: No match found after waiting', waited, 'ms');
                                        return { error: 'resource not found in modelContext' };
                                    }
                                    console.log('[BotDojoChat] tryModelContext: MATCH FOUND:', (match as any).uri);
                                    try {
                                        const content =
                                            typeof match.getContent === 'function'
                                                ? await (match as any).getContent(
                                                      'uriTemplate' in (match as any) && (match as any).uriTemplate
                                                          ? extractTemplateParams((match as any).uriTemplate, uri)
                                                          : undefined
                                                  )
                                                : match;
                                        const html = extractHtmlFromResource(content);
                                        if (!html) {
                                            return { error: 'no html in modelContext resource' };
                                        }
                                        const cspMeta = extractUiCspFromResource(content);
                                        const resolvedCsp = resolveUiCsp(cspMeta);
                                        return {
                                            html,
                                            csp: resolvedCsp.csp,
                                            sandbox: canvasEvent.sandbox || resolvedCsp.sandbox,
                                        };
                                    } catch (e: any) {
                                        return { error: e?.message || 'modelContext getContent error' };
                                    }
                                };

                                // Try modelContext first when provided (has correct CSP with resourceDomains)
                                const mcResult = await tryModelContext();
                                if (mcResult.html) {
                                    return {
                                        html: mcResult.html,
                                        sandbox: mcResult.sandbox || canvasEvent.sandbox,
                                        csp: mcResult.csp,
                                    };
                                }
                                const connectorResult = await tryConnector();
                                if (connectorResult.html) {
                                    return {
                                        html: connectorResult.html,
                                        sandbox: connectorResult.sandbox || canvasEvent.sandbox,
                                        csp: connectorResult.csp,
                                    };
                                }
                                // Note: HTTP(S) URLs are handled directly by the proxy server
                                // Only non-HTTP(S) URLs (app://, mcp://, etc.) reach here via RPC
                                return { ok: false, error: connectorResult.error || mcResult.error || 'sandbox-resource failed' };
                            }

                            const handlerPromises: Promise<any>[] = [];

                            if (canvasEvent?.type === 'link') {
                                if (handlers.onOpenLink) {
                                    try {
                                        const maybe = handlers.onOpenLink(canvasEvent.url, canvasEvent.target || '_blank', canvasEvent.canvasId || 'unknown') as any;
                                        if (maybe && typeof maybe.then === 'function') handlerPromises.push(maybe);
                                    } catch (e) { console.error('[BotDojoChat] Error in onOpenLink:', e); }
                                }
                            } else if (canvasEvent?.type === 'intent') {
                                if (handlers.onToolCall) {
                                    try {
                                        const maybe = handlers.onToolCall(canvasEvent.intent, canvasEvent.params || {}, canvasEvent.canvasId || 'unknown') as any;
                                        if (maybe && typeof maybe.then === 'function') handlerPromises.push(maybe);
                                    } catch (e) { console.error('[BotDojoChat] Error in onToolCall:', e); }
                                }
                            } else if (canvasEvent?.type === 'notify') {
                                if (handlers.onUiMessage) {
                                    try {
                                        const maybe = handlers.onUiMessage(canvasEvent.message, canvasEvent.params || {}, canvasEvent.canvasId || 'unknown') as any;
                                        if (maybe && typeof maybe.then === 'function') handlerPromises.push(maybe);
                                    } catch (e) { console.error('[BotDojoChat] Error in onUiMessage:', e); }
                                }
                            } else if (canvasEvent?.type === 'prompt') {
                                if (handlers.onUiMessage) {
                                    try {
                                        const maybe = handlers.onUiMessage(canvasEvent.prompt, canvasEvent.params || {}, canvasEvent.canvasId || 'unknown') as any;
                                        if (maybe && typeof maybe.then === 'function') handlerPromises.push(maybe);
                                    } catch (e) { console.error('[BotDojoChat] Error in onUiMessage:', e); }
                                }
                            } else if (canvasEvent?.type === 'update') {
                                if (handlers.onUiMessage) {
                                    try {
                                        const maybe = handlers.onUiMessage(canvasEvent.data, {}, canvasEvent.canvasId || 'unknown') as any;
                                        if (maybe && typeof maybe.then === 'function') handlerPromises.push(maybe);
                                    } catch (e) { console.error('[BotDojoChat] Error in onUiMessage:', e); }
                                }
                            } else if (canvasEvent?.type === 'tool') {
                                if (handlers.onToolCall) {
                                    try {
                                        const maybe = handlers.onToolCall(canvasEvent.tool, canvasEvent.params || {}, canvasEvent.canvasId || 'unknown') as any;
                                        if (maybe && typeof maybe.then === 'function') handlerPromises.push(maybe);
                                    } catch (e) { console.error('[BotDojoChat] Error in onToolCall:', e); }
                                }
                            } else if (canvasEvent?.type === 'action') {
                                const actionType = canvasEvent.actionType || canvasEvent.action || canvasEvent.type;
                                if (actionType === 'ui/message') {
                                    if (handlers.onUiMessage) {
                                        try {
                                            const message = (canvasEvent as any)?.content?.[0]?.text || JSON.stringify(canvasEvent).slice(0, 120);
                                            const maybe = handlers.onUiMessage(message, canvasEvent, canvasEvent.canvasId || 'unknown') as any;
                                            if (maybe && typeof maybe.then === 'function') handlerPromises.push(maybe);
                                        } catch (e) { console.error('[BotDojoChat] Error in onUiMessage (ui/message):', e); }
                                    }
                                } else {
                                    console.warn('[BotDojoChat] Ignoring unsupported canvas action type', actionType);
                                }
                            }
                            
                            // Wait for any async handlers before acknowledging
                            if (handlerPromises.length > 0) {
                                try {
                                    const results = await Promise.allSettled(handlerPromises);
                                    if (canvasEvent?.type === 'tool') {
                                        console.log('[BotDojoChat] canvas_event tool handler results', results);
                                        const firstValue = results.find(r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<any>).value !== undefined) as PromiseFulfilledResult<any> | undefined;
                                        if (firstValue) {
                                            console.log('[BotDojoChat] Returning tool handler value to canvas', firstValue.value);
                                            return firstValue.value;
                                        }
                                    }
                                    return { ok: true, results };
                                } catch (e) {
                                    console.error('[BotDojoChat] Error awaiting canvas_event handlers:', e);
                                    return { ok: false, error: String(e) };
                                }
                            }
                            return { ok: true };
                        }

                        // Handle broadcastAgentHostConnected - register ModelContexts with chat iframe router
                        if (msg.functionName === 'broadcastAgentHostConnected') {
                            console.log('[BotDojoChat] Received broadcastAgentHostConnected, registering ModelContext(s) with chat iframe router');

                            // Send ModelContext(s) to chat iframe router for MCP CORS validation
                            // Use ref to get latest modelContext value (not stale closure value)
                            const currentModelContext = modelContextRef.current;
                            const contexts = Array.isArray(currentModelContext) ? currentModelContext : (currentModelContext ? [currentModelContext] : []);
                            for (const ctx of contexts) {
                                try {
                                    console.log(`[BotDojoChat] Registering ModelContext "${ctx.name}" with chat iframe router`);
                                    await connection.sendRequest(
                                        'agent_host',
                                        'registerModelContext',
                                        [ctx],
                                        5000
                                    );
                                    console.log(`[BotDojoChat] ✅ Registered ModelContext "${ctx.name}" with chat iframe router`);
                                } catch (error) {
                                    console.error(`[BotDojoChat] ❌ Error registering ModelContext "${ctx.name}" with chat iframe router:`, error);
                                }
                            }
                            return;
                        }
                        
                        // Check if this is a tool from modelContext - if so, let connector handle it
                        // Use ref to get latest modelContext value (not stale closure value)
                        const currentModelContext = modelContextRef.current;
                        if (currentModelContext) {
                            const contexts = Array.isArray(currentModelContext) ? currentModelContext : [currentModelContext];
                            for (const ctx of contexts) {
                                if (ctx.tools) {
                                    const toolsArray = Array.isArray(ctx.tools) ? ctx.tools : Object.values(ctx.tools);
                                    const isModelContextTool = toolsArray.some(tool => tool.name === msg.functionName);
                                    if (isModelContextTool) {
                                        console.log(`[BotDojoChat] Message is for model context tool ${msg.functionName}, letting connector handle it`);
                                        return; // Don't throw - let connector handle it
                                    }
                                }
                            }
                        }
                        
                        throw new Error(`Unknown function: ${msg.functionName}`);
                    }
                );
                
                // Initialize connection
                await connection.init();
                
                // Register getModelContexts callback
                connection.callbacks.set('getModelContexts', {
                    source: connection.sender,
                    func: async () => {
                        console.log('[BotDojoChat] Handling getModelContexts request');
                        
                        // Use ref to get latest modelContext value (not stale closure value)
                        const currentModelContext = modelContextRef.current;
                        const contexts = Array.isArray(currentModelContext) ? currentModelContext : (currentModelContext ? [currentModelContext] : []);
                        return contexts.map(ctx => {
                            let tools: any[] = [];
                            if (ctx.tools) {
                                // Handle both array and object formats for tools
                                if (Array.isArray(ctx.tools)) {
                                    tools = ctx.tools.map((tool: any) => {
                                        const { execute, ...toolWithoutExecute } = tool;
                                        return toolWithoutExecute;
                                    });
                                } else {
                                    // Object format: convert to array, stripping execute functions
                                    tools = Object.entries(ctx.tools).map(([name, tool]: [string, any]) => {
                                        const { execute, ...toolWithoutExecute } = tool;
                                        return { name, ...toolWithoutExecute };
                                    });
                                }
                            }
                            
                            return {
                                name: ctx.name,
                                description: ctx.description,
                                toolPrefix: ctx.toolPrefix,
                                uri: ctx.uri,
                                tools,
                                prompts: ctx.prompts || [],
                                resources: ctx.resources || []
                            };
                        });
                    }
                });
                
                // Note: update_canvas_data is handled by BotDojoCanvasHost in the chat iframe
                // which has access to the BotDojoChatStoreContext for direct API calls
                
                // Note: Tool callbacks are registered by the BotDojoConnector, not here
                // If we register them here too, tools will be executed twice!
                // The connector's RPCConnection will handle tool execution.
                
                connectionRef.current = connection;
                
                // Mark that modelContext is now captured in this closure
                // This allows tryModelContext to proceed with resource resolution
                // Use ref to check latest value
                modelContextCapturedRef.current = !!modelContextRef.current;
                
                console.log('[BotDojoChat] RPC connection initialized');
                
                // Fire onReady now that RPC connection is established
                // The RPC connection being initialized means bidirectional communication is ready
                // We don't need to wait for chat_ready signal (which may have been sent before we mounted)
                if (!chatReadyFiredRef.current) {
                    console.log('[BotDojoChat] RPC ready, firing onReady');
                    chatReadyRef.current = true;
                    chatReadyFiredRef.current = true;
                    rpcReadyRef.current = true;

                    const handlers = eventHandlersRef.current;
                    if (handlers.onReady) {
                        try { handlers.onReady(); } catch (e) { console.error('[BotDojoChat] Error in onReady:', e); }
                    }
                }
            } catch (error) {
                console.error('[BotDojoChat] Failed to initialize RPC connection:', error);
            }
        };

        initializeConnection();

        return () => {
            // Reset so next effect run can set it again
            modelContextCapturedRef.current = false;
            if (connectionRef.current) {
                connectionRef.current.close();
                connectionRef.current = null;
            }
        };
    }, [connector, iframeLoaded, rpcTrigger]); // Removed modelContext from deps - use ref instead to avoid recreating connection on token changes

    // Re-register model context when it changes (without recreating RPC connection)
    // This handles token refresh scenarios where modelContext is recreated but connection should persist
    useEffect(() => {
        // Skip if connection isn't ready yet (will be registered during initial connection setup)
        if (!connectionRef.current || !rpcReadyRef.current) {
            return;
        }

        const reRegisterModelContext = async () => {
            const connection = connectionRef.current;
            if (!connection) return;

            // Get latest modelContext from ref (not from closure)
            const currentModelContext = modelContextRef.current;
            if (!currentModelContext) {
                return;
            }

            try {
                // Use ref to get latest value
                const contexts = Array.isArray(currentModelContext) ? currentModelContext : [currentModelContext];
                for (const ctx of contexts) {
                    try {
                        console.log(`[BotDojoChat] Re-registering ModelContext "${ctx.name}" after change`);
                        await connection.sendRequest(
                            'agent_host',
                            'registerModelContext',
                            [ctx],
                            5000
                        );
                        console.log(`[BotDojoChat] ✅ Re-registered ModelContext "${ctx.name}"`);
                    } catch (error) {
                        console.error(`[BotDojoChat] ❌ Error re-registering ModelContext "${ctx.name}":`, error);
                    }
                }
            } catch (error) {
                console.error('[BotDojoChat] Error re-registering model context:', error);
            }
        };

        // Only re-register if connection is already established
        // Don't re-register immediately - wait a bit to ensure connection is stable
        const timeoutId = setTimeout(() => {
            reRegisterModelContext();
        }, 100);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [modelContext]); // Only depend on modelContext - connection is stable via ref

    // Parse min/max values
    const parseSize = useCallback((value: string | undefined, defaultVal: number): number => {
        if (!value || value === 'auto') return defaultVal;
        return parseInt(value) || defaultVal;
    }, []);

    // Handle resize start
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        setIsResizing(true);
        resizeStartPos.current = {
            x: e.clientX,
            y: e.clientY,
            width: mode === 'chat-popup' ? popupWidth : panelWidth,
            height: popupHeight,
        };
    }, [mode, panelWidth, popupWidth, popupHeight]);

    // Handle resize during drag
    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            e.preventDefault();

            if (mode === 'chat-popup') {
                // Popup: resize from top-left corner
                const deltaX = resizeStartPos.current.x - e.clientX;
                const deltaY = resizeStartPos.current.y - e.clientY;
                
                const newWidth = Math.max(
                    parseSize(popupConfig.minWidth, 300),
                    Math.min(
                        parseSize(popupConfig.maxWidth, window.innerWidth - 40),
                        resizeStartPos.current.width + deltaX
                    )
                );
                
                const newHeight = Math.max(
                    parseSize(popupConfig.minHeight, 400),
                    Math.min(
                        parseSize(popupConfig.maxHeight, window.innerHeight - 40),
                        resizeStartPos.current.height + deltaY
                    )
                );
                
                setPopupWidth(newWidth);
                setPopupHeight(newHeight);
            } else if (mode === 'side-panel' || mode === 'side-push') {
                // Side panel: resize horizontally
                const isLeft = panelConfig.direction === 'left';
                const delta = isLeft ? e.clientX - resizeStartPos.current.x : resizeStartPos.current.x - e.clientX;
                
                const newWidth = Math.max(
                    parseSize(panelConfig.minWidth, 300),
                    Math.min(
                        parseSize(panelConfig.maxWidth, 800),
                        resizeStartPos.current.width + delta
                    )
                );
                
                setPanelWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // Prevent text selection while resizing
        document.body.style.userSelect = 'none';
        document.body.style.cursor = mode === 'chat-popup' ? 'nwse-resize' : 'ew-resize';

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };
    }, [isResizing, mode, panelConfig.direction, panelConfig.minWidth, panelConfig.maxWidth, 
        popupConfig.minWidth, popupConfig.maxWidth, popupConfig.minHeight, popupConfig.maxHeight, parseSize]);

    // Handle body margin for side-push mode
    useEffect(() => {
        if (mode !== 'side-push') return;

        const bodyMargin = isOpen ? `${panelWidth}px` : '0';
        if (panelConfig.direction === 'left') {
            document.body.style.marginLeft = bodyMargin;
            document.body.style.marginRight = '';
            document.body.style.transition = 'margin-left 0.3s ease-in-out';
        } else {
            document.body.style.marginRight = bodyMargin;
            document.body.style.marginLeft = '';
            document.body.style.transition = 'margin-right 0.3s ease-in-out';
        }

        return () => {
            document.body.style.marginRight = '';
            document.body.style.marginLeft = '';
            document.body.style.transition = '';
        };
    }, [mode, isOpen, panelWidth, panelConfig.direction]);

    // Handle iframe load
    const handleIframeLoad = useCallback(() => {
        console.log('[BotDojoChat] Iframe loaded');
        setIframeLoaded(true);
        iframeLoadedRef.current = true;
        chatReadyRef.current = false; // Reset ready flag, wait for new ready signal
        chatReadyFiredRef.current = false; // Reset fired flag for new iframe session

        setIsLoading(false);
        onLoad?.();
    }, [onLoad]);

    // Toggle chat open/closed
    const toggleChat = useCallback(() => {
        if (mode === 'inline') return;
        
        const newIsOpen = !isOpen;
        setIsOpen(newIsOpen);
        
        if (newIsOpen) {
            // Only show loading spinner if iframe hasn't been loaded yet
            if (!iframeLoaded) {
                setIsLoading(true);
            }
            onOpen?.();
        } else {
            setIsLoading(false);
            onClose?.();
        }
    }, [mode, isOpen, iframeLoaded, onOpen, onClose]);

    // Render styles based on mode
    const getContainerStyles = (): React.CSSProperties => {
        const isSideMode = mode === 'side-panel' || mode === 'side-push';
        
        const baseStyles: React.CSSProperties = {
            width: isSideMode ? `${panelWidth}px` : (mode === 'chat-popup' ? `${popupWidth}px` : width),
            height: mode === 'chat-popup' ? `${popupHeight}px` : height,
        };

        switch (mode) {
            case 'chat-popup':
                return {
                    position: 'fixed',
                    bottom: 0,
                    right: 0,
                    zIndex: 9999,
                    paddingBottom: '20px',
                    paddingRight: '20px',
                    pointerEvents: 'none',
                    maxWidth: 'calc(100% - 20px)',
                    maxHeight: 'calc(100% - 20px)',
                    display: 'flex',
                    flexDirection: 'column-reverse',
                    alignItems: 'flex-end',
                    ...baseStyles,
                };
            
            case 'side-panel':
            case 'side-push': {
                const isLeft = panelConfig.direction === 'left';
                const transitionProp = isLeft ? 'left' : 'right';
                const closedPos = `-${panelWidth}px`;
                
                return {
                    position: 'fixed',
                    top: 0,
                    [transitionProp]: isOpen ? 0 : closedPos,
                    [isLeft ? 'right' : 'left']: 'auto',
                    height: '100vh',
                    width: `${panelWidth}px`,
                    zIndex: 9999,
                    transition: `${transitionProp} 0.3s ease-in-out`,
                    boxShadow: isOpen ? '0 0 20px rgba(0, 0, 0, 0.35)' : 'none',
                };
            }
            
            case 'inline':
                return {
                    position: 'relative',
                    width: '100%',
                    height: height || '100%',
                };
            
            default:
                return baseStyles;
        }
    };

    const getChatStyles = (): React.CSSProperties => {
        const isSideMode = mode === 'side-panel' || mode === 'side-push';
        
        if (mode === 'chat-popup') {
            return {
                display: isOpen ? 'block' : 'none',
                width: '100%',
                height: '100%',
                position: 'relative' as const,
                pointerEvents: 'auto',
                backgroundColor,
                borderRadius: '12px',
                boxShadow: '0 0 10px rgba(0, 0, 0, 0.35)',
                padding: '4px',
                marginBottom: '10px',
                overflow: 'hidden',
            };
        }

        return {
            width: '100%',
            height: '100%',
            backgroundColor,
            borderRadius: isSideMode || mode === 'inline' ? '0' : '12px',
            overflow: 'hidden',
            pointerEvents: 'auto',
            position: 'relative' as const,
        };
    };

    const getButtonStyles = (): React.CSSProperties => {
        const isSideMode = mode === 'side-panel' || mode === 'side-push';
        const isLeft = panelConfig.direction === 'left';
        
        // Side panel buttons are smaller
        const buttonSize = isSideMode ? '48px' : '60px';
        const buttonRadius = isSideMode ? '24px' : '30px';
        const buttonOffset = isSideMode ? '-48px' : 'auto';
        
        return {
            width: buttonSize,
            minWidth: buttonSize,
            height: buttonSize,
            minHeight: buttonSize,
            borderRadius: isSideMode 
                ? (isLeft ? `0 ${buttonRadius} ${buttonRadius} 0` : `${buttonRadius} 0 0 ${buttonRadius}`) 
                : buttonRadius,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: accentColor,
            color: backgroundColor,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'auto',
            boxShadow: '0 0 10px rgba(0, 0, 0, 0.35)',
            position: isSideMode ? 'absolute' : 'relative',
            left: isSideMode && !isLeft ? buttonOffset : 'auto',
            right: isSideMode && isLeft ? buttonOffset : 'auto',
            top: isSideMode ? '50%' : 'auto',
            transform: isSideMode ? 'translateY(-50%)' : 'none',
            // Only show loading animation for popup mode, not side panel
            animation: (!isSideMode && isLoading) ? 'spin 1s linear infinite' : 'none',
        };
    };

    // Icon components
    const ChatIcon = () => widgetImage ? (
        <img src={widgetImage} alt="Chat" style={{ width: '24px', height: '24px' }} />
    ) : (
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z"/>
        </svg>
    );
    
    const CloseIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
        </svg>
    );
    
    const ProgressIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z"/>
        </svg>
    );

    const getButtonIcon = () => {
        if (isLoading) return <ProgressIcon />;
        if (isOpen) return <CloseIcon />;
        return <ChatIcon />;
    };

    // Show connector error
    if (connectorError) {
        return (
            <div
                style={{
                    padding: '20px',
                    backgroundColor: '#fee',
                    border: '1px solid #fcc',
                    borderRadius: '8px',
                    color: '#c00',
                }}
            >
                <strong>Error initializing chat:</strong>
                <br />
                {connectorError.message}
            </div>
        );
    }

    // Show connector loading (only if we need a connector)
    if (needsConnector && isInitializingConnector) {
        return (
            <div
                style={{
                    padding: '20px',
                    textAlign: 'center',
                    color: '#666',
                }}
            >
                Initializing chat...
            </div>
        );
    }

    // Render resize handle
    const renderResizeHandle = () => {
        if (!isOpen) return null;

        if (mode === 'chat-popup' && popupConfig.resizable) {
            // Popup: top-left corner handle
            return (
                <div
                    onMouseDown={handleResizeStart}
                    style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        width: '20px',
                        height: '20px',
                        cursor: 'nwse-resize',
                        zIndex: 10001,
                        pointerEvents: 'auto',
                        background: 'linear-gradient(135deg, rgba(0,0,0,0.08) 50%, transparent 50%)',
                        borderRadius: '8px 0 0 0',
                        opacity: 0.6,
                        transition: 'opacity 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.6';
                    }}
                    title="Drag to resize"
                />
            );
        }

        if ((mode === 'side-panel' || mode === 'side-push') && panelConfig.resizable) {
            // Side panel: edge handle
            const isLeft = panelConfig.direction === 'left';
            return (
                <div
                    onMouseDown={handleResizeStart}
                    style={{
                        position: 'absolute',
                        top: 0,
                        [isLeft ? 'right' : 'left']: 0,
                        width: '6px',
                        height: '100%',
                        cursor: 'ew-resize',
                        backgroundColor: 'rgba(0, 0, 0, 0.05)',
                        zIndex: 10001,
                        transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.15)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
                    }}
                    title="Drag to resize"
                />
            );
        }

        return null;
    };

    // Render button
    const renderButton = () => {
        if (mode === 'inline') return null;

        return (
            <button
                onClick={toggleChat}
                style={getButtonStyles()}
                aria-label={isOpen ? 'Close chat' : 'Open chat'}
                title={isOpen ? 'Close chat' : 'Open chat'}
            >
                {getButtonIcon()}
            </button>
        );
    };

    

    // Render iframe
    const renderIframe = () => {
        // Don't render iframe until apiKey is available (prevents loading with key=null)
        if (!iframeApiKey) {
            return null;
        }

        // For popup/side-panel modes, don't create iframe until chat is opened (unless it was already loaded once)
        if ((mode === 'chat-popup' || mode === 'side-panel' || mode === 'side-push') && !isOpen && !iframeLoaded) {
            return null;
        }

        const iframeStyles: React.CSSProperties = {
            width: '100%',
            height: '100%',
            border: 'none',
        };

        return (
            <div style={getChatStyles()}>
                <iframe
                    ref={iframeRef}
                    src={iframeUrl}
                    style={iframeStyles}
                    allow={allowMicrophone ? 'microphone' : undefined}
                    onLoad={handleIframeLoad}
                    title="BotDojo Chat"
                />

                {renderResizeHandle()}
            </div>
        );
    };

    // Don't render anything until apiKey is available
    // This prevents state corruption from null -> token transition
    if (!apiKey) {
        return null;
    }

    return (
        <>
            <style>
                {`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}
            </style>
            <div ref={containerRef} style={getContainerStyles()}>
                {(mode === 'side-panel' || mode === 'side-push') && renderButton()}
                {mode === 'chat-popup' && renderButton()}
                {renderIframe()}
            </div>
        </>
    );
};
