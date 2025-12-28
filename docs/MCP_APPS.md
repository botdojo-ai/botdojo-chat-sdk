# MCP Apps Guide

MCP Apps are interactive UI components that render inside the chat as tool results. They enable rich, bidirectional interactions between the AI and your application.

## Overview

When a tool with a `resourceUri` is executed, BotDojo renders the associated MCP App (HTML content) in a sandboxed iframe. The MCP App can:

- Display streaming content as the AI generates it
- Show the final tool result
- Call tools back to the host to trigger actions
- Persist state across page reloads

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                       Your App                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  BotDojoChat                         │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │         Tool with resourceUri                │    │   │
│  │  │  ┌─────────────────────────────────────┐    │    │   │
│  │  │  │         MCP App (iframe)            │    │    │   │
│  │  │  │  - Receives tool arguments          │    │    │   │
│  │  │  │  - Displays streaming content       │    │    │   │
│  │  │  │  - Can call tools back to host      │    │    │   │
│  │  │  └─────────────────────────────────────┘    │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Setting Up MCP Apps

### 1. Define a Tool with resourceUri

In your `ModelContext`, create a tool with `_meta.ui.resourceUri`:

```typescript
const modelContext: ModelContext = {
  name: 'my_context',
  toolPrefix: 'my_prefix',
  uri: 'my://context',
  tools: [
    {
      name: 'enhanceDescription',
      description: 'Enhance a product description and show preview.',
      inputSchema: {
        type: 'object',
        properties: {
          enhanced_text: { type: 'string' }
        },
        required: ['enhanced_text']
      },
      _meta: {
        ui: {
          // This links the tool to its MCP App
          resourceUri: 'ui://my-context/enhance-preview',
          prefersProxy: true,
        }
      },
      execute: async (params) => {
        return { enhanced: params.enhanced_text };
      }
    }
  ],
  resources: [
    {
      // Must exactly match the tool's resourceUri
      uri: 'ui://my-context/enhance-preview',
      name: 'Enhancement Preview',
      mimeType: 'text/html;profile=mcp-app',
      getContent: async () => ({
        uri: 'ui://my-context/enhance-preview',
        mimeType: 'text/html;profile=mcp-app',
        text: '<html>...</html>'
      })
    }
  ]
};
```

### 2. Build the MCP App

Create a React component using `useMcpApp`:

```typescript
import { useMcpApp } from '@botdojo/chat-sdk/mcp-app-view/react';

function MyMcpApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { tool, callTool, hostContext } = useMcpApp({
    containerRef,
    autoReportSize: true,
    onToolInputPartial: (params) => {
      // Receive streaming updates
      console.log('Streaming:', params.arguments);
    }
  });

  // Access final result
  const result = tool.result;

  return (
    <div ref={containerRef}>
      {/* Your UI */}
    </div>
  );
}
```

### 3. Connect Tool to Resource

The `resourceUri` in the tool's `_meta.ui` must **exactly match** the `uri` in the resources array:

```typescript
// Tool definition
_meta: {
  ui: {
    resourceUri: 'ui://my-context/preview'  // ← Must match
  }
}

// Resource definition  
resources: [
  {
    uri: 'ui://my-context/preview'  // ← Must match
  }
]
```

## State Management

### Using Refs for Current State

Tool execute functions inside `useMemo` capture state from when the memo was created. Use refs to access current values:

```typescript
const [text, setText] = useState('initial');
const textRef = useRef(text);

// Keep ref in sync
useEffect(() => {
  textRef.current = text;
}, [text]);

const modelContext = useMemo(() => ({
  tools: [{
    execute: async () => {
      // ✅ Always gets current value
      return { content: textRef.current };
    }
  }]
}), []);
```

### Persisting MCP App State

Use `botdojo/persist` to save state across page reloads:

```typescript
// In your MCP App
await client.sendRequest('ui/message', {
  role: 'user',
  content: {
    type: 'botdojo/persist',
    state: { applied: true, selectedOption: 'A' }
  }
});

// On reload, access via hostContext.state
const savedState = hostContext?.state;
```

## Streaming

### Receiving Streaming Updates

Use `onToolInputPartial` to receive streaming tool arguments:

```typescript
const { tool } = useMcpApp({
  onToolInputPartial: (params) => {
    // params.arguments contains partial data
    const args = params.arguments as Record<string, unknown>;
    if (typeof args.text === 'string') {
      setStreamingText(args.text);
    }
  }
});
```

### Sending Streaming Updates from Tool

Use `notifyToolInputPartial` to stream data during tool execution:

```typescript
execute: async (params, context) => {
  // Stream partial data to MCP App
  context?.notifyToolInputPartial?.({ 
    progress: 50,
    partialResult: 'Processing...' 
  });
  
  return { finalResult: 'Done' };
}
```

### Detecting Completion

Use `tool.result` to detect when streaming completes:

```typescript
useEffect(() => {
  if (tool.result) {
    // Tool execution completed
    setShowFinalView(true);
  }
}, [tool.result]);
```

## Calling Tools from MCP Apps

MCP Apps can call tools defined in the host's ModelContext:

```typescript
const { callTool } = useMcpApp({ ... });

const handleApply = async () => {
  const result = await callTool('updateDescription', {
    description: newText
  });
  console.log('Tool result:', result);
};
```

## Size Reporting

MCP Apps run in iframes. Report size changes so the host can resize:

```typescript
const { reportSize } = useMcpApp({
  containerRef,
  autoReportSize: true  // Handles initial sizing
});

// For dynamic content, manually report
useEffect(() => {
  const rect = containerRef.current?.getBoundingClientRect();
  if (rect) {
    reportSize(rect.width, rect.height);
  }
}, [content]);
```

## Example: Product Enhancement

See the complete example in the playground:
- Host page: `sdk-playground/pages/examples/product-enhance/index.tsx`
- MCP App: `sdk-playground/pages/examples/product-enhance/widgets/enhance-mcp-app.tsx`

## Example: Document Editor with Diff Review

See the complete example in the playground:
- Host page: `sdk-playground/pages/examples/document-edit/index.tsx`
- MCP App: `sdk-playground/pages/examples/document-edit/widgets/review-mcp-app.tsx`


