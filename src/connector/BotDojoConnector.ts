import type { ModelContext, FlowRequestOptions, FlowRequestBody, FlowResponse, BackendModelContext, ToolExecutionResult } from "@botdojo/sdk-types";
import { mapToolResponseToBackend, translateModelContextToBackend, isDynamicResource } from "@botdojo/sdk-types";
import { RPCConnection, RPCMessage, ChannelListener, PostMessageBridge, PostMessageRPCClient, ConectionOptions } from "botdojo-rpc";


function env(key: string): string | null {
    if (typeof process !== "undefined" && process.env && process.env[key]) {
        return process.env[key] as string;
    }
    if (typeof window !== "undefined" && (window as any)[key]) {
        return (window as any)[key];
    }
    return null
}

const getBaseUrl = () => {
    // Check for explicit env var or window config first
    const explicitUrl = env("BOTDOJO_CONNECTOR_API_URL");
    if (explicitUrl) {
        return explicitUrl;
    }
    
    // Auto-detect based on where the bundle/page is loaded from
    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        // If running on localhost, connect to local dev server
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:5001/api/v1/';
        }
    }
    
    // Default to production
    return "https://api.botdojo.com/api/v1/";
};

// Note: Types are exported from index.ts which re-exports from botdojo-sdk-types

/**
 * Configuration class for handling flow request events
 */
export class RequestEvents {
    public events?: string[];
    public onFlowRequestStart?: (data: any) => void;
    public onNewToken?: (data: any) => void;
    public onStepUpdate?: (data: any) => void;  // ← RENAMED from onIntermediateStepUpdate
    public onFlowRequestEnd?: (data: any) => void;
    public onLog?: (data: any) => void;

    constructor(options: {
        events?: string[];
        onFlowRequestStart?: (data: any) => void;
        onNewToken?: (data: any) => void;
        onStepUpdate?: (data: any) => void;  // ← RENAMED from onIntermediateStepUpdate
        onFlowRequestEnd?: (data: any) => void;
        onLog?: (data: any) => void;
    } = {}) {
        this.events = [];
        if(options.onFlowRequestStart)
        {
            this.events.push('onFlowRequestStart');
        }
        if(options.onNewToken)
        {
            this.events.push('onNewToken');
        }
        if(options.onStepUpdate)
        {
            this.events.push('onIntermediateStepUpdate');  // ← Map to internal event name
        }
        if(options.onFlowRequestEnd)
        {
            this.events.push('onFlowRequestEnd');
        }
        if(options.onLog)
        {
            this.events.push('onLog');
        }

    }

    /**
     * Get the events to listen for, with default fallback
     */
    getEvents(): string[] {
        return this.events || ['onNewToken', 'onIntermediateStepUpdate', 'onFlowRequestEnd', 'onFlowRequestStart', 'onLog'];
    }

    /**
     * Check if a specific event has a callback
     */
    hasCallback(eventType: string): boolean {
        switch (eventType) {
            case 'onFlowRequestStart': return !!this.onFlowRequestStart;
            case 'onNewToken': return !!this.onNewToken;
            case 'onIntermediateStepUpdate': return !!this.onStepUpdate;  // ← RENAMED
            case 'onFlowRequestEnd': return !!this.onFlowRequestEnd;
            case 'onLog': return !!this.onLog;
            default: return false;
        }
    }

    /**
     * Execute the appropriate callback for an event
     */
    executeCallback(eventType: string, data: any): void {
        switch (eventType) {
            case 'onFlowRequestStart':
                this.onFlowRequestStart?.(data);
                break;
            case 'onNewToken':
                this.onNewToken?.(data);
                break;
            case 'onIntermediateStepUpdate':
                this.onStepUpdate?.(data);  // ← RENAMED
                break;
            case 'onFlowRequestEnd':
                this.onFlowRequestEnd?.(data);
                break;
            case 'onLog':
                this.onLog?.(data);
                break;
        }
    }

    /**
     * Create a RequestEvents instance with only token streaming
     */
    static tokenStreaming(onNewToken: (data: any) => void): RequestEvents {
        return new RequestEvents({
            events: ['onNewToken', 'onFlowRequestEnd'],
            onNewToken,
        });
    }

    /**
     * Create a RequestEvents instance with all events
     */
    static allEvents(callbacks: {
        onFlowRequestStart?: (data: any) => void;
        onNewToken?: (data: any) => void;
        onIntermediateStepUpdate?: (data: any) => void;
        onFlowRequestEnd?: (data: any) => void;
        onLog?: (data: any) => void;
    }): RequestEvents {
        return new RequestEvents(callbacks);
    }
}

// Extended FlowRequestOptions with additional fields specific to BotDojoConnector
export interface ExtendedFlowRequestOptions extends FlowRequestOptions {
    id?: string;
    flow_session_id?: string;
    version?: string;
    override?: any;
    external_ui_channel_id: string;
    evalOptions?: {
        runMode?: 'async' | 'block' | 'skip';
        runs?: Array<{
            flowEvalId: string;
            flowEvalExternalInput?: any;
        }>;
    };
}
/**
 * Non-React client for connecting to BotDojo Flow Request API.
 * Manages model context registration and tool call handling.
 * 
 * Can use either PostMessage (for iframe embedding) or an external RPCConnection (for direct server communication).
 */
export class BotDojoConnector {
    private apiKey: string;
  
    private sessionId: string | null = null;
    private external_ui_channel_id: string;
    private modelContext: ModelContext | ModelContext[] | null = null;
    private nestedMcpCache: Map<string, { mcp: any[], timestamp: number }> = new Map(); // Cache for nested MCP resources
    private _hostClient: RPCConnection | null = null;
    private hasInit: boolean = false;
    private clientId: string;
    private hostClientId: string;
    private canvasClientId: string | null = null;
    private defaultCanvasId: string | null = null;
    private registeredModelContexts: Map<string, any> = new Map();
    
    // Canvas update callbacks for parent-executed tools
    private activeCanvasUpdates = new Map<string, (data: any) => void>();
    
    // PostMessage support
    private transport: 'rpc' | 'postmessage';
    private targetWindow: Window | null = null;  // For postMessage mode (default: window.parent)
    private connection: RPCConnection | null = null;  // Unified connection for postMessage mode
    
    // CORS configuration
    private toolCallCors?: { allowedToolCallOrigins?: string[] };  // From constructor
    private botdojoChatDomain?: string[];  // Set by canvas host from flow settings

    constructor(props: {
        apiKey: string;
        accountId?: string;
        projectId?: string;
        flowId?: string;
        modelContext?: ModelContext | ModelContext[];
        sessionId?: string;
        external_ui_channel_id?: string;
        transport?: 'rpc' | 'postmessage';
        targetWindow?: Window;
        hostClient?: RPCConnection;  // Optional RPC connection to use as agent_host
        canvasId?: string;  // Optional: Canvas iframes don't need to know their ID (routing is handled by chat client)
    }) {
        this.apiKey = props.apiKey;
        this.sessionId = props.sessionId || null;
        this.transport = props.transport || 'postmessage'; // Default to postMessage
        this.external_ui_channel_id = props.external_ui_channel_id || this.generateChannelId();
        
        // Use provided hostClient or null
        this._hostClient = props.hostClient || null;
        
        this.modelContext = props.modelContext || null;
        
        // Extract CORS config from modelContext (only allowedToolCallOrigins)
        // botdojoChatDomain will be set later by canvas host from flow settings
        const firstContext = this.modelContext ? (Array.isArray(this.modelContext) ? this.modelContext[0] : this.modelContext) : null;
        this.toolCallCors = firstContext?.cors ? {
            allowedToolCallOrigins: firstContext.cors.allowedToolCallOrigins
        } : undefined;
        this.clientId = `connector_${this.external_ui_channel_id}`;
        this.hostClientId = 'agent_host'; // Fixed: Must match what CanvasModelContextNode and server expect
        
        // Resolve canvasId (optional - canvas iframes don't need to know their ID)
        // The chat client handles message routing via PostMessage bridges
        const urlCanvasId = this.getCanvasIdFromUrl();
        if (props.canvasId) {
            this.defaultCanvasId = props.canvasId;
            this.canvasClientId = `canvas:${props.canvasId}`;
        } else if (urlCanvasId) {
            this.defaultCanvasId = urlCanvasId;
            this.canvasClientId = `canvas:${urlCanvasId}`;
        } else {
            const firstContext = this.modelContext ? (Array.isArray(this.modelContext) ? this.modelContext[0] : this.modelContext) : null;
            this.canvasClientId = firstContext ? `canvas:${firstContext.name}` : null;
            this.defaultCanvasId = this.canvasClientId ? this.canvasClientId.replace(/^canvas:/, '') : null;
        };
        
        // Store target window for postMessage mode
        // For parent pages embedding chat, targetWindow will be set later via updatePostMessageTarget()
        // For canvas iframes, targetWindow is window.parent and is provided in constructor
        if (this.transport === 'postmessage') {
            this.targetWindow = props.targetWindow || null;
            
            // If targetWindow is provided (e.g., canvas iframe → parent), create RPCConnection now
            if (this.targetWindow) {
                this.createPostMessageConnection(this.targetWindow);
            }
        }
        
        // Register the model context(s) if provided
        // Store the ORIGINAL SDK ModelContext, not the translated version
        // This allows tools with execute functions to be available when getModelContexts is called
        if (this.modelContext) {
            const contexts = Array.isArray(this.modelContext) ? this.modelContext : [this.modelContext];
            
            for (const ctx of contexts) {
                // Store the original SDK context, not translated
                // We'll translate on-demand in getModelContexts
                this.registeredModelContexts.set(ctx.name, ctx);
            }
        }
    }

    /** Expose the current RPC connection (postMessage/RPC) for host bridges */
    public getConnection(): RPCConnection | null {
        return this.connection;
    }

    private generateChannelId(): string {
        // Generate a proper UUID for the external UI channel
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Attempt to read canvas_id from the current URL.
     * 
     * NOTE: Canvas iframes don't actually need to know their canvasId.
     * The canvasId is for the chat client's internal routing (mapping messages to iframes).
     * The chat client knows which iframe sent a message by which PostMessage bridge it came from.
     * 
     * This method exists for backwards compatibility with legacy canvases that may
     * expect to read canvas_id from URL params. New MCP-UI canvases should not rely on this.
     */
    private getCanvasIdFromUrl(): string | null {
        if (typeof window === 'undefined') {
            return null;
        }
        try {
            const params = new URLSearchParams(window.location.search);
            const urlCanvasId = params.get('canvas_id');
            return urlCanvasId || null;
        } catch {
            return null;
        }
    }

    /**
     * Create PostMessage RPC connection and register callbacks
     */
    private createPostMessageConnection(targetWindow: Window): void {
        // Create PostMessageRPCClient (implements IRPC_Client)
        // Use canvasClientId (canvas:<name>) if available, otherwise use connector clientId
        const effectiveClientId = this.canvasClientId || this.clientId;
        
        // Build CORS config from constructor parameter and canvas host setting
        // - allowedToolCallOrigins: From constructor (SDK user specifies)
        // - botdojoChatDomain: From canvas host via setBotDojoChatDomain() (flow settings)
        const corsConfig = (this.toolCallCors || this.botdojoChatDomain) ? {
            allowedToolCallOrigins: this.toolCallCors?.allowedToolCallOrigins,
            botdojoChatDomain: this.botdojoChatDomain
        } : undefined;
        
        const client = new PostMessageRPCClient(
            targetWindow,
            {
                getToken: async () => this.apiKey,
                clientId: effectiveClientId,
                defaultDestinationId: 'agent_host',
                baseChannel: 'connector',
            },
            '*', // targetOrigin
            true,  // debug
            'canvas', // role - this is the canvas SDK
            corsConfig
        );
        
        // Wrap in RPCConnection for automatic request/response handling
        this.connection = new RPCConnection(
            client,
            new ConectionOptions(),
            this.handleIncomingMessage.bind(this)
        );
        
        // Register callbacks from model contexts
        this.registerCallbacks();
    }

    /**
     * Register all callbacks for incoming requests
     */
    private registerCallbacks(): void {
        if (!this.connection) return;
        
        // Register getModelContexts
        this.connection.callbacks.set('getModelContexts', {
            source: this.connection.sender,
            func: async () => {
                return Array.from(this.registeredModelContexts.values()).map(ctx => {
                    // Translate SDK ModelContext to backend format on-demand
                    const backendFormat = translateModelContextToBackend(ctx);
                    
                    // Strip execute functions from tools for postMessage serialization
                    const tools = (backendFormat.tools || []).map(tool => {
                        const { execute, ...toolWithoutExecute } = tool as any;
                        return toolWithoutExecute;
                    });
                    
                    return {
                        ...backendFormat,
                        tools,
                        uri: backendFormat.resourceUri
                    };
                });
            }
        });
        
        // Register getModelContext
        this.connection.callbacks.set('getModelContext', {
            source: this.connection.sender,
            func: async (contextName: string) => {
                const context = this.registeredModelContexts.get(contextName);
                if (!context) {
                    throw new Error(`Model context '${contextName}' not found`);
                }
                return context;
            }
        });
        
        // Register registerModelContext
        this.connection.callbacks.set('registerModelContext', {
            source: this.connection.sender,
            func: async (newContext: any) => {
                this.registeredModelContexts.set(newContext.name, newContext);
                return null;
            }
        });
        
        // Register unregisterModelContext
        this.connection.callbacks.set('unregisterModelContext', {
            source: this.connection.sender,
            func: async (contextName: string) => {
                this.registeredModelContexts.delete(contextName);
                return null;
            }
        });
        
        // Register getResource
        this.connection.callbacks.set('getResource', {
            source: this.connection.sender,
            func: async (resourceUri: string, params?: any, onlyMetadata?: boolean) => {
                const result = await this.handleGetResource(resourceUri, params, onlyMetadata);
                
                // Strip execute functions from nested MCPs before sending
                if (result && result.mcp && Array.isArray(result.mcp)) {
                    return {
                        ...result,
                        mcp: result.mcp.map((mcp: any) => ({
                            ...mcp,
                            tools: (mcp.tools || []).map((tool: any) => {
                                const { execute, ...toolWithoutExecute } = tool;
                                return toolWithoutExecute;
                            })
                        }))
                    };
                }
                return result;
            }
        });
        
        // Register ping
        this.connection.callbacks.set('ping', {
            source: this.connection.sender,
            func: async () => 'pong'
        });
        
        // Register update_canvas_data handler
        // This forwards the canvas data update to the parent host (BotDojoChat or canvas host)
        // which will make the actual API call to persist the data
        this.connection.callbacks.set('update_canvas_data', {
            source: this.connection.sender,
            func: async (canvasData: any) => {
                console.log('[BotDojoConnector] Handling update_canvas_data callback - delegating to parent', canvasData);
                
                // The actual persistence is handled by the parent (chat/canvas host)
                // which has access to the backend API and authentication
                // Just acknowledge receipt here - the real work happens in the parent
                return { success: true, message: 'Canvas data update forwarded to parent' };
            }
        });
        
        // Register tool callbacks from modelContext ONLY
        // Tools must be defined in ModelContext for proper execution
        if (this.modelContext) {
            const contexts = Array.isArray(this.modelContext) ? this.modelContext : [this.modelContext];
            
            for (const ctx of contexts) {
                if (ctx.tools) {
                    // Handle both array and Record types for tools
                    const toolsArray = Array.isArray(ctx.tools) 
                        ? ctx.tools 
                        : Object.values(ctx.tools);
                    
                    for (const tool of toolsArray) {
                        if (tool.execute && tool.name) {
                            const toolName = tool.name;
                            // Get resource template from _meta.ui.resourceUri (MCP-UI spec pattern)
                            const uiResourceUri = tool._meta?.ui?.resourceUri;
                                    const hasResourceTemplate = !!uiResourceUri;
                                    // Get display name from _meta (new pattern) or fallback to toolName
                                    const displayName = tool._meta?.['botdojo/display-name'] || toolName;
                                    
                                    this.connection.callbacks.set(toolName, {
                                source: this.connection.sender,
                                // Callback receives (toolArgs, toolContext) where toolContext = { stepId, canvasId }
                                func: async (toolArgs: any, toolContext?: { stepId: string; canvasId?: string }) => {
                                    // Clean RPC routing: use context from second argument
                                    const stepId = toolContext?.stepId;
                                    const canvasId = toolContext?.canvasId;
                                    
                                    if (!stepId) {
                                        console.warn(`[BotDojoConnector] Tool ${toolName} called without stepId in toolContext`);
                                    }
                                    
                                    // If tool has resource template, provide ToolExecutionContext
                                    if (hasResourceTemplate) {
                                        const baseToolInfo = {
                                            toolName,
                                            toolLabel: displayName,
                                            arguments: toolArgs,
                                        };
                                        
                                        if (!canvasId) {
                                            console.warn(`[BotDojoConnector] Canvas tool ${toolName} called without canvasId in toolContext`);
                                        }
                                        
                                        const canvasType = 'mcp-app';
                                        const toolExecContext = {
                                            toolName,
                                            stepId,
                                            canvasId,
                                            updateState: async (state: any) => {
                                                if (canvasId || stepId) {
                                                    await this.sendCanvasUpdate(stepId, canvasId, state, canvasType, baseToolInfo);
                                                }
                                            },
                                            notifyToolInputPartial: async (args: Record<string, unknown>) => {
                                                if (canvasId || stepId) {
                                                    // Send step update with arguments for MCP App notifications
                                                    // Note: canvasData is undefined so canvas won't be included in update
                                                    await this.sendCanvasUpdate(stepId, canvasId, undefined, canvasType, {
                                                        ...baseToolInfo,
                                                        arguments: args,
                                                    });
                                                }
                                            },
                                            notifyToolInput: async (args: Record<string, unknown>) => {
                                                if (canvasId || stepId) {
                                                    await this.sendCanvasUpdate(stepId, canvasId, undefined, canvasType, {
                                                        ...baseToolInfo,
                                                        arguments: args
                                                    });
                                                }
                                            },
                                            notifyToolResult: async (result: any) => {
                                                if (canvasId || stepId) {
                                                    await this.sendCanvasUpdate(stepId, canvasId, undefined, canvasType, {
                                                        ...baseToolInfo,
                                                        result: result
                                                    });
                                                }
                                            }
                                        };
                                        
                                        // Call tool with clean args and execution context
                                        const rawresult = await (tool.execute as any)(toolArgs, toolExecContext) as ToolExecutionResult;
                                        
                                        // Automatically notify tool completion - no need for tools to call this manually
                                        await toolExecContext.notifyToolResult(rawresult);
                                        
                                        return await mapToolResponseToBackend(rawresult);
                                   
                                    }
                                    
                                    // No resource template - still provide streaming context so tools can emit canvas updates
                                    const baseToolInfo = {
                                        toolName,
                                        toolLabel: displayName,
                                        arguments: toolArgs,
                                    };
                                    const toolExecContext = {
                                        toolName,
                                        stepId,
                                        canvasId,
                                        updateState: async (state: any) => {
                                            // No resource template, use default type
                                            await this.sendCanvasUpdate(stepId, canvasId, state, undefined, baseToolInfo);
                                        },
                                        notifyToolInputPartial: async (args: Record<string, unknown>) => {
                                            await this.sendCanvasUpdate(stepId, canvasId, undefined, undefined, {
                                                ...baseToolInfo,
                                                arguments: args,
                                            });
                                        },
                                        notifyToolInput: async (args: Record<string, unknown>) => {
                                            await this.sendCanvasUpdate(stepId, canvasId, undefined, undefined, {
                                                ...baseToolInfo,
                                                arguments: args
                                            });
                                        },
                                        notifyToolResult: async (result: any) => {
                                            await this.sendCanvasUpdate(stepId, canvasId, undefined, undefined, {
                                                ...baseToolInfo,
                                                result: result
                                            });
                                        }
                                    };

                                    const rawResult = await (tool.execute as any)(toolArgs, toolExecContext) as ToolExecutionResult;
                                    
                                    // Automatically notify tool completion - no need for tools to call this manually
                                    await toolExecContext.notifyToolResult(rawResult);
                                    
                                    return await mapToolResponseToBackend(rawResult);
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    /**
     * Handle incoming messages not covered by registered callbacks
     */
    private processToolResult(result: any, tool: any): any {
        // Intercept add_canvas action and convert to _canvas for Agent Node compatibility
        if (result && result.actions && Array.isArray(result.actions)) {
            const addCanvasAction = result.actions.find((a: any) => a.type === 'add_canvas');
            if (addCanvasAction && addCanvasAction.data) {
                const actionData = addCanvasAction.data;
                const providedCanvasId =
                    actionData.canvasId ||
                    actionData.canvas_id ||
                    actionData.canvasData?.canvasId ||
                    actionData.canvasData?.canvas_id ||
                    actionData.canvasData?.metadata?.['mcpui.dev/canvas-id'];
                const canvasId = providedCanvasId || this.defaultCanvasId || this.getCanvasIdFromUrl() || this.generateChannelId();
                const baseCanvasData = actionData.canvasData || actionData;
                const showInline = baseCanvasData?.show_inline ?? true;
                const agentEnabled = baseCanvasData?.agent_enabled ?? (actionData.type === 'dojo-canvas' ? true : false);
                result._canvas = {
                    canvasId, 
                    canvasType: addCanvasAction.data.type || 'dojo-canvas',
                    canvasData: {
                        ...baseCanvasData,
                        toolName: tool.name,
                        toolDisplayName: tool._meta?.['botdojo/display-name'] || tool.name,
                        show_inline: showInline,
                        agent_enabled: agentEnabled,
                    },
                    width: addCanvasAction.data.width,
                    height: addCanvasAction.data.height,
                };
            }
        }
        return result;
    }

    private async handleIncomingMessage(msg: RPCMessage): Promise<any> {
        // Accept tool calls from agent (origin='server', trusted)
        // Router sets this when proxying agent → canvas tool calls
        if (msg.origin === 'server') {
            // Agent tool call, always allowed
            // Fall through to normal handling
        }

        // Handle broadcastAgentHostConnected
        if (msg.functionName === 'broadcastAgentHostConnected') {
            
            // Register all our model contexts with the agent_host
            for (const [contextName, ctx] of this.registeredModelContexts.entries()) {
                try {
                    // Translate SDK ModelContext to backend format
                    const backendFormat = translateModelContextToBackend(ctx);
                    
                    const tools = (backendFormat.tools || []).map(tool => {
                        const { execute, ...toolWithoutExecute } = tool as any;
                        return toolWithoutExecute;
                    });
                    
                    const contextToRegister = {
                        ...backendFormat,
                        tools,
                        uri: backendFormat.resourceUri,
                        // Attach the parent's CORS policy from BotDojoChat props
                        cors: this.toolCallCors ? {
                            allowedToolCallOrigins: this.toolCallCors.allowedToolCallOrigins
                        } : undefined
                    };
                    
                    // Send registerModelContext request to agent_host
                    await this.connection!.sendRequest(
                        'agent_host',
                        'registerModelContext',
                        [contextToRegister],
                        5000
                    );
                    console.log(`[BotDojoConnector] ✅ Registered model context: ${contextName}`);
                } catch (error) {
                    console.error(`[BotDojoConnector] ❌ Error registering context ${contextName}:`, error);
                }
            }
            return;
        }
        
        // Check if it's a tool call from registered model contexts
        for (const [contextName, ctx] of this.registeredModelContexts.entries()) {
            const toolPrefix = ctx.toolPrefix ? `${ctx.toolPrefix}:` : '';
            
            // Handle both array and object formats for tools
            let toolsArray: any[] = [];
            if (ctx.tools) {
                if (Array.isArray(ctx.tools)) {
                    toolsArray = ctx.tools;
                } else {
                    // Convert object to array with names
                    toolsArray = Object.entries(ctx.tools).map(([name, tool]) => ({ name, ...(tool as any) }));
                }
            }
            
            const tool = toolsArray.find((t: any) => {
                const fullToolName = toolPrefix + t.name;
                return fullToolName === msg.functionName || t.name === msg.functionName;
            });
            
            if (tool && typeof tool.execute === 'function') {
                const result = await tool.execute(...(msg.data || []));
                
                return this.processToolResult(result, tool);
            }
        }
        
        // Check nested MCP cache for tool
        for (const [resourceUri, cached] of this.nestedMcpCache.entries()) {
            for (const mcp of cached.mcp) {
                const expectedDestination = `canvas:${mcp.name}`;
                if (msg.destination === expectedDestination) {
                    const tool = (mcp.tools || []).find((t: any) => t.name === msg.functionName);
                    if (tool && typeof tool.execute === 'function') {
                        // Strip _resourceUri from args
                        const cleanedArgs = (msg.data || []).map((arg: any) => {
                            if (arg && typeof arg === 'object' && '_resourceUri' in arg) {
                                const { _resourceUri, ...rest } = arg;
                                return rest;
                            }
                            return arg;
                        });
                        const result = await tool.execute(...cleanedArgs);
                        
                        return this.processToolResult(result, tool);
                    }
                }
            }
        }
        
        console.warn('[BotDojoConnector] Unknown function:', msg.functionName);
        throw new Error(`Unknown function: ${msg.functionName}`);
    }

    /**
     * Handle getResource requests
     * Supports both static and dynamic resources from the unified resources array
     */
    private async handleGetResource(resourceUri: string, params?: any, onlyMetadata?: boolean): Promise<any> {
        
        // Search through resources in all registered model contexts
        for (const ctx of this.registeredModelContexts.values()) {
            if (!ctx.resources || !Array.isArray(ctx.resources)) continue;
            
            for (const resource of ctx.resources) {
                let matches = false;
                let extractedParams = params || {};
                
                // Check if resource is dynamic (has uriTemplate) or static (has uri)
                if (isDynamicResource(resource)) {
                    // Dynamic resource: check if URI matches template
                    const template = (resource as any).uriTemplate;
                    if (this.matchesUriTemplate(resourceUri, template)) {
                        matches = true;
                        // Extract parameters from URI and merge with provided params
                        extractedParams = {
                            ...this.extractUriParams(resourceUri, template),
                            ...params
                        };
                    }
                } else {
                    // Static resource: exact URI match
                    if ((resource as any).uri === resourceUri) {
                        matches = true;
                    }
                }
                
                if (matches && resource.getContent) {
                    try {
                        // Return metadata only if requested
                        if (onlyMetadata) {
                            return {
                                uri: resourceUri,
                                mimeType: resource.mimeType,
                                meta: (resource as any).meta || {
                                    description: resource.description,
                                    label: (resource as any).label
                                }
                            };
                        }
                        
                        // Get resource content
                        const content = isDynamicResource(resource)
                            ? await resource.getContent(extractedParams)
                            : await resource.getContent();
                        
                        
                        // Handle different content formats
                        let result: any;
                        if (typeof content === 'string') {
                            result = {
                                uri: resourceUri,
                                mimeType: resource.mimeType,
                                text: content
                            };
                        } else if ('url' in content && !('text' in content) && !('mcp' in content)) {
                            // URL reference
                            result = {
                                uri: resourceUri,
                                mimeType: resource.mimeType,
                                text: JSON.stringify({ url: content.url })
                            };
                        } else {
                            // Rich ResourceContent object
                            result = {
                                uri: resourceUri,
                                mimeType: resource.mimeType,
                                ...content
                            };
                        }
                        
                        // Cache nested MCPs so their tools can be called later
                        if (result.mcp && Array.isArray(result.mcp) && result.mcp.length > 0) {
                            this.nestedMcpCache.set(resourceUri, {
                                mcp: result.mcp,
                                timestamp: Date.now()
                            });
                            
                            // Register tool handlers for nested MCP tools so they can be called
                            for (const nestedMcp of result.mcp) {
                                const nestedClientId = `canvas:${nestedMcp.name}`;
                                
                                for (const tool of (nestedMcp.tools || [])) {
                                    const toolName = tool.name;
                                    const toolExecute = tool.execute;
                                    
                                    if (toolExecute && typeof toolExecute === 'function' && this.connection) {
                                        const nestedFunctionName = `${nestedClientId}_${toolName}`;
                                        
                                        // Register the tool callback on THIS connector (parent)
                                        // When called, execute the tool from the cached MCP
                                        this.connection.callbacks.set(nestedFunctionName, {
                                            source: this.connection.sender,
                                            func: async (...args: any[]) => {
                                                try {
                                                    const result = await toolExecute(...args);
                                                    return result;
                                                } catch (error) {
                                                    console.error(`[BotDojoConnector] Nested tool error:`, error);
                                                    throw error;
                                                }
                                            }
                                        });
                                    }
                                }
                            }
                        }
                        
                        return result;
                    } catch (error) {
                        console.error('[BotDojoConnector] Error getting resource:', error);
                        throw new Error(`Failed to get resource: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
        }
        
        throw new Error(`Resource not found: ${resourceUri}`);
    }
    
    /**
     * Check if a URI matches a template (simple implementation)
     */
    private matchesUriTemplate(uri: string, template: string): boolean {
        // Convert template to regex, allowing path parameters to match multiple segments
        // "vfs://file/{filepath}" -> "vfs://file/(.+)" to match "Projects/test.txt"
        const regexPattern = template.replace(/\{[^}]+\}/g, '(.+)');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(uri);
    }
    
    /**
     * Extract parameters from URI based on template
     * Handles multi-segment parameters like {filepath} matching "Projects/test.txt"
     */
    private extractUriParams(uri: string, template: string): Record<string, string> {
        const params: Record<string, string> = {};
        
        // Build regex with named groups
        let regexPattern = template;
        const paramNames: string[] = [];
        
        // Extract parameter names and build regex
        regexPattern = regexPattern.replace(/\{([^}]+)\}/g, (_, paramName) => {
            paramNames.push(paramName);
            return '(.+)';  // Match one or more characters (including slashes)
        });
        
        const regex = new RegExp(`^${regexPattern}$`);
        const match = uri.match(regex);
        
        if (match) {
            // Extract matched values
            for (let i = 0; i < paramNames.length; i++) {
                params[paramNames[i]] = match[i + 1];  // match[0] is full string, params start at index 1
            }
        }
        
        return params;
    }


    
    /**
     * Initialize the connector
     */
    async init(): Promise<void> {
        if (this.hasInit) {
            console.log(`BotDojoConnector already initialized`);
            return;
        }

        try {
            // Initialize RPCConnection if already created (e.g., canvas iframe → parent)
            if (this.transport === 'postmessage' && this.connection) {
                await this.connection.init();
            }
            
            // If using RPC mode with hostClient, register agent_host callbacks
            if (this.transport === 'rpc' && this._hostClient) {
                this.setupHostClientCallbacks();
            }

            this.hasInit = true;
            console.log(`BotDojoConnector initialized successfully`);

        } catch (error) {
            console.error('Failed to initialize BotDojoConnector:', error);
            throw error;
        }
    }

    /**
     * Setup agent_host callbacks on the provided RPCConnection
     */
    private setupHostClientCallbacks(): void {
        if (!this._hostClient) return;


        // Register model context management handlers
        this._hostClient.callbacks.set('getModelContexts', {
            source: this._hostClient.sender,
            func: async () => {
                console.log('🎯 HOST: getModelContexts called');
                console.log(`🎯 HOST: Current registered contexts: ${this.registeredModelContexts.size}`);
                // Translate SDK ModelContext to backend format on-demand
                const contexts = Array.from(this.registeredModelContexts.values()).map(ctx => {
                    const backendFormat = translateModelContextToBackend(ctx);
                    
                    // Strip execute functions from tools for RPC serialization
                    const tools = (backendFormat.tools || []).map(tool => {
                        const { execute, ...toolWithoutExecute } = tool as any;
                        return toolWithoutExecute;
                    });
                    
                    return {
                        ...backendFormat,
                        tools,
                        uri: backendFormat.resourceUri
                    };
                });
                console.log(`🎯 HOST: Returning ${contexts.length} model contexts:`, contexts.map(c => c.name));
                return contexts;
            },
        });

        this._hostClient.callbacks.set('getModelContext', {
            source: this._hostClient.sender,
            func: async (name: string) => {
                console.log(`Host: getModelContext called for: ${name}`);
                const context = this.registeredModelContexts.get(name);
                if (!context) {
                    throw new Error(`Model context '${name}' not found`);
                }
                return context;
            },
        });

        this._hostClient.callbacks.set('registerModelContext', {
            source: this._hostClient.sender,
            func: async (data: any) => {
                console.log(`Host: registerModelContext called for: ${data.name}`);
                this.registeredModelContexts.set(data.name, data);
                return;
            },
        });

        this._hostClient.callbacks.set('unregisterModelContext', {
            source: this._hostClient.sender,
            func: async (data: any) => {
                console.log(`Host: unregisterModelContext called for: ${data.name}`);
                this.registeredModelContexts.delete(data.name);
                return;
            },
        });

        this._hostClient.callbacks.set('getResource', {
            source: this._hostClient.sender,
            func: async (resourceUri: string) => {
                console.log(`Host: getResource called for: ${resourceUri}`);
                return await this.handleGetResource(resourceUri);
            },
        });

        this._hostClient.callbacks.set('ping', {
            source: this._hostClient.sender,
            func: async () => {
                console.log('Received ping on agent host, responding with pong');
                return "pong";
            },
        });

        // Register tool call handlers from modelContext ONLY
        // Tools must be defined in ModelContext for proper execution
        if (this.modelContext) {
            const contexts = Array.isArray(this.modelContext) ? this.modelContext : [this.modelContext];
            console.log(`🔧 [hostClient] Registering tools from ${contexts.length} modelContext(s)`);
            
            for (const ctx of contexts) {
                if (ctx.tools) {
                    const toolsArray = Array.isArray(ctx.tools) ? ctx.tools : Object.values(ctx.tools);
                    
                    for (const tool of toolsArray) {
                        if (tool.execute && tool.name) {
                            const toolName = tool.name;
                            // Get resource template from _meta.ui.resourceUri (MCP-UI spec pattern)
                            const uiResourceUri = tool._meta?.ui?.resourceUri;
                            const hasResourceTemplate = !!uiResourceUri;
                            // Get display name from _meta (new pattern) or fallback to toolName
                            const displayName = tool._meta?.['botdojo/display-name'] || toolName;
                            console.log(`🔧 Registering modelContext tool on host client: ${toolName}, hasResource: ${hasResourceTemplate}`);
                            
                            this._hostClient.callbacks.set(toolName, {
                                source: this._hostClient.sender,
                                // Callback receives (toolArgs, toolContext) where toolContext = { stepId, canvasId }
                                func: async (toolArgs: any, toolContext?: { stepId: string; canvasId?: string }) => {
                                    console.log(`🔧 Executing modelContext tool: ${toolName}`, { toolArgs, toolContext });
                                    try {
                                        // Clean RPC routing: use context from second argument
                                        const stepId = toolContext?.stepId;
                                        const canvasId = toolContext?.canvasId;
                                        
                                        if (!stepId) {
                                            console.warn(`[BotDojoConnector hostClient] Tool ${toolName} called without stepId in toolContext`);
                                        }
                                        
                                        // If tool has resource template, provide ToolExecutionContext
                                        if (hasResourceTemplate) {
                                            const baseToolInfo = {
                                                toolName,
                                                toolLabel: displayName,
                                                arguments: toolArgs,
                                            };
                                            
                                            if (!canvasId) {
                                                console.warn(`[BotDojoConnector hostClient] Canvas tool ${toolName} called without canvasId in toolContext`);
                                            }
                                            
                                            console.log(`[BotDojoConnector hostClient] Tool has resource, ids → step: ${stepId}, canvas: ${canvasId}`);
                                            
                                            const canvasType = 'mcp-app';
                                            const toolExecContext = {
                                                toolName,
                                                stepId,
                                                canvasId,
                                                updateState: async (state: any) => {
                                                    console.log(`[BotDojoConnector hostClient] updateState called for canvasId: ${canvasId ?? stepId}`, state);
                                                    if (canvasId || stepId) {
                                                        await this.sendCanvasUpdate(stepId, canvasId, state, canvasType, baseToolInfo);
                                                    }
                                                },
                                                notifyToolInputPartial: async (args: Record<string, unknown>) => {
                                                    if (canvasId || stepId) {
                                                        await this.sendCanvasUpdate(stepId, canvasId, undefined, canvasType, {
                                                            ...baseToolInfo,
                                                            arguments: args,
                                                        });
                                                    }
                                                },
                                                notifyToolInput: async (args: Record<string, unknown>) => {
                                                    if (canvasId || stepId) {
                                                        await this.sendCanvasUpdate(stepId, canvasId, undefined, canvasType, {
                                                            ...baseToolInfo,
                                                            arguments: args
                                                        });
                                                    }
                                                },
                                                notifyToolResult: async (result: any) => {
                                                    if (canvasId || stepId) {
                                                        await this.sendCanvasUpdate(stepId, canvasId, undefined, canvasType, {
                                                            ...baseToolInfo,
                                                            result: result
                                                        });
                                                    }
                                                }
                                            };
                                            
                                            const rawresult = await (tool.execute as any)(toolArgs, toolExecContext) as ToolExecutionResult;
                                            
                                            // Automatically notify tool completion - no need for tools to call this manually
                                            await toolExecContext.notifyToolResult(rawresult);

                                            const result = await mapToolResponseToBackend(rawresult);
                                            console.log(`✅ Tool executed successfully: ${toolName}`);
                                            return result;
                                        }
                                        
                                        // No resource template - still provide streaming context so tools can emit canvas updates
                                        const baseToolInfo = {
                                            toolName,
                                            toolLabel: displayName,
                                            arguments: toolArgs,
                                        };
                                        const toolExecContext = {
                                            toolName,
                                            stepId,
                                            canvasId,
                                            updateState: async (state: any) => {
                                                // No resource template, use default type
                                                await this.sendCanvasUpdate(stepId, canvasId, state, undefined, baseToolInfo);
                                            },
                                            notifyToolInputPartial: async (args: Record<string, unknown>) => {
                                                await this.sendCanvasUpdate(stepId, canvasId, undefined, undefined, {
                                                    ...baseToolInfo,
                                                    arguments: args
                                                });
                                            },
                                            notifyToolInput: async (args: Record<string, unknown>) => {
                                                await this.sendCanvasUpdate(stepId, canvasId, undefined, undefined, {
                                                    ...baseToolInfo,
                                                    arguments: args
                                                });
                                            },
                                            notifyToolResult: async (result: any) => {
                                                await this.sendCanvasUpdate(stepId, canvasId, undefined, undefined, {
                                                    ...baseToolInfo,
                                                    result: result
                                                });
                                            }
                                        };
                                        const rawresult = await (tool.execute as any)(toolArgs, toolExecContext) as ToolExecutionResult;
                                        
                                        // Automatically notify tool completion - no need for tools to call this manually
                                        await toolExecContext.notifyToolResult(rawresult);

                                        const result = await mapToolResponseToBackend(rawresult);
                                        console.log(`✅ Tool executed successfully: ${toolName}`);
                                        return result;
                                    } catch (error) {
                                        console.error(`❌ Error executing tool ${toolName}:`, error);
                                        throw error;
                                    }
                                },
                            });
                        }
                    }
                }
            }
        }

        // Note: executeFlowRun handler may be registered by parent/host if they want to handle flow.run() requests

        console.log('[BotDojoConnector] Agent_host callbacks setup complete');
    }

    /**
     * Close RPC connection
     */
    async close(): Promise<void> {
        if (this.hasInit) {
            try {
                // Close RPC connection if active
                if (this.connection) {
                    await this.connection.close();
                }
                
                this.hasInit = false;
                console.log('BotDojoConnector closed successfully');
            } catch (error) {
                console.error('Error closing BotDojoConnector:', error);
            }
        }
    }

    isConnected(): boolean {
        return this.hasInit && (this.transport === 'postmessage' || !!this._hostClient);
    }

    /**
     * Update the targetWindow for postMessage mode and initialize the RPC connection
     */
    async updatePostMessageTarget(targetWindow: Window): Promise<void> {
        if (this.transport === 'postmessage') {
            console.log('[BotDojoConnector] updatePostMessageTarget', {
                transport: this.transport,
                hasTargetWindow: !!targetWindow,
                hasExistingConnection: !!this.connection
            });
            
            this.targetWindow = targetWindow;
            
            // Close existing connection if any
            if (this.connection) {
                console.log('[BotDojoConnector] Closing existing connection');
                await this.connection.close();
            }
            
            // Create and initialize new RPC connection with correct target window
            this.createPostMessageConnection(this.targetWindow);
            
            // Initialize the connection
            await this.connection!.init();
        }
    }

    getSessionId(): string | null {
        return this.sessionId;
    }

    getExternalUIChannelId(): string {
        return this.external_ui_channel_id;
    }

    /**
     * Get the external UI socket URL that matches the format expected by CanvasModelContextNode
     */
    getExternalUISocketUrl(): string {
        const baseUrl = getBaseUrl().replace(/\/$/, ''); // Remove trailing slash
        return `${baseUrl}/rpc/uc/${this.external_ui_channel_id}_extui`;
    }

    getApiKey(): string {
        return this.apiKey;
    }



    setModelContext(modelContext: ModelContext | ModelContext[]): void {
        this.modelContext = modelContext;
        // Also register it in the host
        // Store the ORIGINAL SDK ModelContext, translate on-demand
        if (modelContext) {
            const contexts = Array.isArray(modelContext) ? modelContext : [modelContext];
            
            for (const ctx of contexts) {
                // Store the original SDK context, not translated
                this.registeredModelContexts.set(ctx.name, ctx);
            }
        }
    }

    /**
     * Get all registered model contexts
     */
    getRegisteredModelContexts(): any[] {
        return Array.from(this.registeredModelContexts.values());
    }

    /**
     * Register a new model context
     */
    registerModelContext(context: any): void {
        this.registeredModelContexts.set(context.name, context);
        console.log(`Registered model context: ${context.name}`);
    }

    /**
     * Unregister a model context
     */
    unregisterModelContext(name: string): void {
        this.registeredModelContexts.delete(name);
        console.log(`Unregistered model context: ${name}`);
    }

    /**
     * Get the current model context(s)
     */
    getModelContext(): ModelContext | ModelContext[] | null {
        return this.modelContext;
    }

    /**
     * Note: sendMessage, callFlow, and related flow execution methods have been removed.
     * Flow execution should be handled by external callers using the BotDojo API directly.
     * This connector focuses on model context management and tool call handling via postMessage or RPC.
     */

    /**
     * Register a canvas update callback for a step
     * Used to enable real-time canvas updates from parent-executed tools
     * 
     * @param stepId - The step ID to associate with this canvas
     * @param callback - Function to call when canvas data is updated
     */
    registerCanvasUpdateCallback(stepId: string, callback: (data: any) => void): void {
        console.log(`[BotDojoConnector] Registering canvas update callback for step: ${stepId}`);
        this.activeCanvasUpdates.set(stepId, callback);
    }
    
    /**
     * Unregister a canvas update callback
     * Should be called when tool execution completes
     * 
     * @param stepId - The step ID to unregister
     */
    unregisterCanvasUpdateCallback(stepId: string): void {
        console.log(`[BotDojoConnector] Unregistering canvas update callback for step: ${stepId}`);
        this.activeCanvasUpdates.delete(stepId);
    }
    
    /**
     * Send a canvas update to the agent host
     * This forwards canvas data to the parent window, which will forward it to the canvas iframe
     * 
     * @param stepId - The step ID associated with the canvas (falls back to canvasId)
     * @param canvasId - The canvas ID receiving updates (falls back to stepId)
     * @param canvasData - The canvas data to send
     * @param canvasType - The canvas type (e.g., 'mcp-app') for proper rendering
     */
    async sendCanvasUpdate(
        stepId: string | undefined,
        canvasId: string | undefined,
        canvasData: any,
        canvasType?: string,
        toolInfo?: { toolName?: string; toolLabel?: string; arguments?: any; result?: any }
    ): Promise<void> {
        const resolvedStepId = stepId || canvasId;
        const resolvedCanvasId = canvasId || stepId;

        if (!resolvedStepId || !resolvedCanvasId) {
            console.warn('[BotDojoConnector] Missing stepId/canvasId for canvas update, skipping', {
                stepId,
                canvasId,
                canvasData
            });
            return;
        }

        
        // Send as intermediate step update with canvas data
        // BotDojoCanvasHost will extract canvas.canvasId and route to the correct canvas
        // Include canvasType so frontend knows how to render the canvas (e.g., external URL iframe)
        // IMPORTANT: Only include canvas when canvasData is provided - otherwise the merge will
        // wipe out existing canvas data. Tool args/results are stored on the step, not canvasData.
        const stepUpdate: Record<string, any> = {
            stepId: resolvedStepId,
            toolPhase: 'executing', // Indicate that tool is executing so canvas shows progress view
            stepStatus: 'processing', // Indicate that step is in progress
            ...(toolInfo?.toolName ? { toolName: toolInfo.toolName } : {}),
            ...(toolInfo?.toolLabel ? { toolLabel: toolInfo.toolLabel } : {}),
            ...(toolInfo?.arguments !== undefined ? { arguments: toolInfo.arguments } : {}),
            ...(toolInfo?.result !== undefined ? { result: toolInfo.result } : {}),
        };
        
        // Only include full canvas object when we have actual canvas data to send
        // This prevents notifyToolInputPartial from wiping out existing canvas state
        if (canvasData !== undefined) {
            stepUpdate.canvas = {
                canvasId: resolvedCanvasId,
                canvasType: canvasType || 'mcp-app',
                canvasData: canvasData
            };
        }
        
        // For progress updates (no canvasData), include canvasId at top level for routing
        // This allows BotDojoCanvasHost to route without affecting canvas render state
        if (resolvedCanvasId && canvasData === undefined) {
            stepUpdate.canvasId = resolvedCanvasId;
        }
        
        // In postMessage mode, send to parent via RPCConnection
        if (this.transport === 'postmessage' && this.connection) {
            await this.connection.sendRequest(
                'agent_host',
                'onIntermediateStepUpdate',
                [stepUpdate],
                5000
            );
            return;
        }
        
        // In RPC mode, send via Socket.IO
        if (this._hostClient) {
            await this._hostClient.sendRequest(
                'agent_host',
                'onIntermediateStepUpdate',
                [stepUpdate],
                5000
            );
            return;
        }
        
        console.warn(`[BotDojoConnector] No connection available to send canvas update for step: ${resolvedStepId}`);
    }

    /**
     * Execute a tool call if it exists
     * In postMessage mode: sends request to parent via RPCConnection
     * In RPC mode: sends request via Socket.IO RPCConnection
     * 
     * @param toolName - The name of the tool to execute
     * @param args - Arguments to pass to the tool
     * @param stepId - Optional step ID for canvas updates (if tool has canvas template)
     */
    async executeToolCall(toolName: string, ...args: any[]): Promise<any> {
        console.log('[BotDojoConnector] executeToolCall', {
            transport: this.transport,
            hasConnection: !!this.connection,
            hasHostClient: !!this._hostClient,
            hasInit: this.hasInit,
            toolName,
            args
        });
        
        // In postMessage mode, use RPCConnection to send to parent
        if (this.transport === 'postmessage' && this.connection) {
            const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
            console.log(`[BotDojoConnector] [CORS DEBUG] Executing tool via PostMessage RPCConnection: ${toolName}`, {
                toolName,
                currentOrigin,
                args,
                hasConnection: !!this.connection,
                connectorClientId: this.clientId
            });
            return await this.connection.sendRequest(
                'agent_host',
                toolName,
                args,
                30000
            );
        }
        
        // Use RPC connection if available (RPC mode)
        if (this._hostClient) {
            console.log(`[BotDojoConnector] Executing tool via Socket.IO RPCConnection: ${toolName}`, args);
            return await this._hostClient.sendRequest(
                'agent_host',
                toolName,
                args,
                30000
            );
        }
        
        throw new Error(`No connection available for tool call: ${toolName}. Tools must be executed remotely via ModelContext.`);
    }

    /**
     * Execute a flow run request
     * In postMessage mode: sends request to parent/host who will call flow.run() API
     * In RPC mode: sends request via Socket.IO to agent_host
     * 
     * @param body - The flow request body (e.g., { message: "Hello" })
     * @returns The flow response including status, response, aiMessage, etc.
     */
    async run(body: any): Promise<FlowResponse> {
        // In postMessage mode, use RPCConnection to send to parent
        if (this.transport === 'postmessage' && this.connection) {
            return await this.connection.sendRequest(
                'agent_host',
                'executeFlowRun',
                [body],
                60000 // 60 second timeout
            );
        }
        
        // Use RPC connection if available (RPC mode)
        if (this._hostClient) {
            console.log(`[BotDojoConnector] Executing flow run via Socket.IO RPCConnection`, body);
            return await this._hostClient.sendRequest(
                'agent_host',
                'executeFlowRun',
                [body],
                60000 // 60 second timeout
            );
        }
        
        throw new Error('No connection available for flow run. Transport must be configured.');
    }

    /**
     * Reset the session (will create a new session on next request)
     */
    resetSession(): void {
        this.sessionId = null;
    }

    /**
     * Send a message to the chat iframe and wait for the flow response
     * This is useful for parent pages that want to programmatically send messages to the chat
     * 
     * @param message - The message to send to the chat
     * @returns Promise that resolves with the FlowResponse from the chat
     */
    async sendMessageToChat(message: string): Promise<FlowResponse> {
        console.log(`[BotDojoConnector] Sending message to chat: ${message}`);
        
        // In postMessage mode, use RPCConnection to send to chat iframe
        if (this.transport === 'postmessage' && this.connection) {
            return await this.connection.sendRequest(
                'chat_client',
                'sendMessage',
                [message],
                60000 // 60 second timeout
            );
        }
        
        // In RPC mode, send via Socket.IO and wait for response
        if (this._hostClient) {
            return await this._hostClient.sendRequest(
                'chat_client',
                'sendMessage',
                [message],
                60000 // 60 second timeout
            );
        }
        
        throw new Error('No connection available to send message to chat');
    }



    /**
     * Call a remote function with timeout (needed for agent_host compatibility)
     * Now unified for both transports!
     */
    async callWithTimeout(target: string, functionName: string, timeoutMs: number, ...args: any[]): Promise<any> {
        if (this._hostClient) {
            // Use sendRequest with timeout (works for both RPC and postMessage!)
            return await this._hostClient.sendRequest(target, functionName, args, timeoutMs);
        }
        throw new Error('Host client not initialized');
    }

    /**
     * Update canvas data and persist it to the backend
     * This allows canvases to maintain state across page refreshes
     *
     * @param state - The updated canvas state to persist
     * @returns Promise that resolves when the data is saved
     */
    async updateState(state: any): Promise<any> {
        console.log(`[BotDojoConnector] updateState called`, state);

        // Include canvas_id in the data so the host knows which canvas to update
        const dataWithCanvasId = {
            canvas_id: this.canvasClientId?.replace('canvas:', ''),
            ...state
        };

        // In postMessage mode, use RPCConnection to send to parent
        if (this.transport === 'postmessage' && this.connection) {
            console.log(`[BotDojoConnector] Updating canvas data via PostMessage RPCConnection`, dataWithCanvasId);
            return await this.connection.sendRequest(
                'agent_host',
                'update_canvas_data',
                [dataWithCanvasId],
                30000 // 30 second timeout
            );
        }

        // Use RPC connection if available (RPC mode)
        if (this._hostClient) {
            console.log(`[BotDojoConnector] Updating canvas data via Socket.IO RPCConnection`, dataWithCanvasId);
            return await this._hostClient.sendRequest(
                'agent_host',
                'update_canvas_data',
                [dataWithCanvasId],
                30000 // 30 second timeout
            );
        }

        throw new Error('No connection available for canvas data update. Transport must be configured.');
    }

    /**
     * Set botdojoChatDomain from flow chat settings
     * Called by canvas host after it receives config from server
     * 
     * This is separate from the constructor's cors parameter because:
     * - Constructor cors: Set by SDK user (allowedToolCallOrigins)
     * - botdojoChatDomain: Set by flow settings (server-side configuration)
     * 
     * @param domains - Allowed chat iframe domains from flow settings
     */
    setBotDojoChatDomain(domains: string[] | undefined): void {
        this.botdojoChatDomain = domains;
        console.log('[BotDojoConnector] Set botdojoChatDomain from flow settings:', domains);
        
        // Update existing PostMessage client if it exists
        if (this.connection?.sender && 'bridge' in this.connection.sender) {
            const client = this.connection.sender as any;
            if (client.bridge && client.bridge.updateConfig) {
                client.bridge.updateConfig({
                    cors: {
                        botdojoChatDomain: domains,
                        allowedToolCallOrigins: this.toolCallCors?.allowedToolCallOrigins
                    }
                });
                console.log('[BotDojoConnector] Updated PostMessage bridge CORS config');
            }
        }
    }
}

// Export helper functions
export { detectTransportFromURL, extractChannelIdFromSocketUrl } from "botdojo-rpc";
