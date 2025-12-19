/**
 * Shared utilities for MCP App hosting
 */

/**
 * Default host capabilities for MCP Apps
 */
export const DEFAULT_MCP_HOST_CAPABILITIES = {
  openLinks: {},
  'botdojo/persistence': true,
  extensions: {
    'io.modelcontextprotocol/ui': {
      mimeTypes: ['text/html+mcp', 'text/html;profile=mcp-app'],
    },
  },
};

/**
 * Parse a value that might be a JSON string into an object.
 * Used for hydrating tool arguments and results from server data.
 * 
 * @param value - The value to parse (string, object, or undefined)
 * @returns Parsed object, original value, or undefined
 */
export function parseMaybeJson(value: any): Record<string, unknown> | any {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object') return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Generate a stable content key for iframe change detection.
 * Changes to this key indicate content has changed enough to warrant iframe reload.
 * 
 * Per MCP spec (SEP-1865), we only support proxy URLs (no blob URLs).
 * 
 * @param url - URL string (proxy URL)
 * @returns A stable key representing the content
 */
export function getContentKey(url: string | undefined): string {
  if (url) return `url:${url}`;
  return 'empty';
}

/**
 * Validate tool notification parameters.
 * Prevents sending empty/invalid notifications to MCP Apps.
 * 
 * @param params - The notification params
 * @param kind - Type of notification: 'partial', 'input', or 'result'
 * @returns true if params are valid and should be sent
 */
export function validateToolParams(
  params: any,
  kind: 'partial' | 'input' | 'result'
): boolean {
  if (kind === 'result') {
    const result = params?.result;
    return result !== undefined && result !== '';
  }
  // For input and partial
  const args = params?.arguments;
  return args && args !== '' && typeof args === 'object' && Object.keys(args).length > 0;
}

/**
 * Process a step update into tool notifications.
 * Centralizes the logic for converting step updates to MCP App notifications.
 */
export interface StepUpdate {
  stepToolName?: string;
  toolName?: string;
  stepToolArguments?: any;
  stepToolResult?: any;
  stepToolProgress?: any;
  toolPhase?: string;
  stepId?: string;
  stepLabel?: string;
}

export interface ToolNotification {
  method: string;
  params: {
    tool: { name: string };
    arguments?: any;
    result?: any;
  };
}

/**
 * Process a step update and return notifications to send to the MCP App.
 * 
 * @param stepUpdate - The step update from the server
 * @returns Array of notifications to send
 */
export function processStepUpdate(stepUpdate: StepUpdate): ToolNotification[] {
  const notifications: ToolNotification[] = [];
  const toolName = stepUpdate.stepToolName || stepUpdate.toolName;
  
  if (!toolName) return notifications;
  
  // Progress update (tool-input-partial)
  if (stepUpdate.stepToolProgress) {
    notifications.push({
      method: 'ui/notifications/tool-input-partial',
      params: {
        tool: { name: toolName },
        arguments: { ...stepUpdate.stepToolProgress, _botdojoProgress: true },
      },
    });
  } else if (stepUpdate.toolPhase === 'streaming_args' && (stepUpdate.stepId || stepUpdate.stepLabel)) {
    notifications.push({
      method: 'ui/notifications/tool-input-partial',
      params: {
        tool: { name: toolName },
        arguments: {
          ...(stepUpdate.stepToolArguments || {}),
          stepId: stepUpdate.stepId,
          stepLabel: stepUpdate.stepLabel,
        },
      },
    });
  }
  
  // Tool input (when streaming complete)
  if (stepUpdate.toolPhase === 'executing' && stepUpdate.stepToolArguments) {
    const args = parseMaybeJson(stepUpdate.stepToolArguments);
    if (args && typeof args === 'object' && Object.keys(args).length > 0) {
      notifications.push({
        method: 'ui/notifications/tool-input',
        params: {
          tool: { name: toolName },
          arguments: args,
        },
      });
    }
  }
  
  // Tool result
  const result = parseMaybeJson(stepUpdate.stepToolResult);
  if (result !== undefined && result !== '') {
    notifications.push({
      method: 'ui/notifications/tool-result',
      params: {
        tool: { name: toolName },
        result,
      },
    });
  }
  
  return notifications;
}
