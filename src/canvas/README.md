# Canvas Components

Canvas components for building inline canvas cards in BotDojo chat widgets. Supports legacy dojo canvas RPCs and native MCP-UI verbs (plus BotDojo streaming extensions) via a single provider.

## Overview

Canvas cards are React components that render inline in the chat message stream. They provide interactive UI elements that can:
- Send messages back to the flow
- Display rich content (products, forms, media, etc.)
- Be tested standalone without the chat widget

## Key Concepts

### Providers

**1. BotDojoCanvasProvider (Production, dual-mode)**
- `mode="dojo"` (default): legacy canvas RPCs + streaming
- `mode="mcp-ui"`: emits MCP-UI verbs with BotDojo extensions (messageId acks, streaming, ui-size-change); legacy RPC mirroring is on by default
- Receives connector from parent chat; auto-creates postMessage connector in iframes

**2. McpUiCanvasProvider (MCP-UI default)**
- Thin wrapper around `BotDojoCanvasProvider` with `mode="mcp-ui"`
- Use for MCP-UI canvases (external URL, inline HTML, Remote DOM)

**3. MockCanvasProvider (Development/Testing)**
- Used for standalone canvas development
- Simulates runtime with mock callbacks
- Perfect for Storybook, testing, or development
- No API key or chat widget needed

**Helper: BotDojoUIResourceHandler**
- Wraps `@mcp-ui/client`’s `UIResourceRenderer` (optional peer, loaded dynamically)
- Forwards MCP-UI actions to the provider (tool/message/intent/update/link/prompt/notify) with optional `messageId` acks
- Handles `ui-size-change` and BotDojo streaming extensions for Remote DOM/HTML resources

### useBotDojoCanvas Hook

Both providers work with the same hook:

```typescript
const canvas = useBotDojoCanvas();

// Available properties:
canvas.isReady        // boolean - canvas is ready
canvas.error          // Error | null
canvas.canvasData     // any - data for this canvas card
canvas.renderData     // any - MCP-UI lifecycle render payload
canvas.messageIdMap   // Map of messageId -> { status, payload, error, ts }
canvas.uiSize         // { width, height } last measured size
canvas.connector      // BotDojoConnector | null (only in production)
canvas.isMockMode     // boolean - true for MockCanvasProvider

// Available methods:
canvas.sendMessage(text, params, opts)
canvas.sendIntent(intent, params, opts)
canvas.sendNotify(message, params, opts)
canvas.sendLink(url, target, opts)
canvas.sendPrompt(prompt, params, opts)
canvas.sendTool(name, args, opts)   // MCP-UI tool/callTool
canvas.sendUpdate(data, opts)       // MCP-UI update
canvas.dispatchUIAction(action, opts) // Low-level MCP-UI action sender
canvas.on(event, handler)           // Listen to events
```

## Usage Examples

### 1. Production Canvas (Inside Chat Widget)

```typescript
import { BotDojoCanvasProvider, useBotDojoCanvas } from '@botdojo/chat-sdk';

function ProductCanvas() {
  const canvas = useBotDojoCanvas();
  
  const handleAskAI = async () => {
    await canvas.sendMessage(`Tell me about ${canvas.canvasData?.name}`);
  };
  
  if (!canvas.canvasData) return null;
  
  return (
    <div>
      <h3>{canvas.canvasData.name}</h3>
      <p>${canvas.canvasData.price}</p>
      <button onClick={handleAskAI}>Ask AI</button>
    </div>
  );
}

// In your chat message renderer:
function MessageRenderer({ message, connector }) {
  if (message.canvas) {
    return (
      <BotDojoCanvasProvider
        canvasData={message.canvas.data}
        connector={connector}
      >
        <ProductCanvas />
      </BotDojoCanvasProvider>
    );
  }
  
  return <div>{message.content}</div>;
}
```

### 1b. MCP-UI Canvas (Remote DOM with BotDojo extensions)

```tsx
import { McpUiCanvasProvider, BotDojoUIResourceHandler } from '@botdojo/chat-sdk';

const resource = {
  uri: 'ui://demo/canvas',
  mimeType: 'application/vnd.mcp-ui.remote-dom',
  text: "export default async function render({ channel, data }) { channel.on('mcp-ui:botdojo-tool-update', console.log); }",
};

export default function DemoCanvas() {
  return (
    <McpUiCanvasProvider initialRenderData={{ status: 'loading' }}>
      <BotDojoUIResourceHandler resource={resource} />
    </McpUiCanvasProvider>
  );
}
```
Use `sendIntent`, `sendMessage`, `sendTool`, or `dispatchUIAction` inside your Remote DOM script; BotDojo extensions (`botdojo/tool_update`, `messageId` acks, `ui-size-change`) flow through automatically.

### 2. Development/Testing (Standalone)

```typescript
import { MockCanvasProvider } from '@botdojo/chat-sdk';
import { ProductCanvas } from './ProductCanvas';

export default function TestPage() {
  return (
    <MockCanvasProvider
      mockCanvasData={{
        id: '123',
        name: 'iPhone',
        price: 999,
        description: 'Great phone'
      }}
      onSendMessage={async (text, params) => {
        console.log('Mock sendMessage:', text, params);
        alert(`Would send: ${text}`);
        return { success: true };
      }}
      debug={true}
    >
      <ProductCanvas />
    </MockCanvasProvider>
  );
}
```

### 3. Pre-built ProductCard Component

```typescript
import { MockCanvasProvider, ProductCard } from '@botdojo/chat-sdk';

export default function TestProductCard() {
  return (
    <MockCanvasProvider
      mockCanvasData={{
        name: 'MacBook Pro',
        price: 1999,
        description: 'Powerful laptop',
        image: '/macbook.jpg'
      }}
      onSendMessage={async (text) => {
        console.log('AI message:', text);
        return { success: true };
      }}
    >
      <ProductCard 
        onAddToCart={(product, quantity) => {
          console.log('Add to cart:', product, quantity);
        }}
      />
    </MockCanvasProvider>
  );
}
```

## Creating Custom Canvas Components

### Step 1: Define Your Component

```typescript
import { useBotDojoCanvas } from '@botdojo/chat-sdk';

export function MyCanvas() {
  const canvas = useBotDojoCanvas();
  
  const handleAction = async () => {
    await canvas.sendMessage('User clicked button');
  };
  
  if (!canvas.isReady) {
    return <div>Loading...</div>;
  }
  
  return (
    <div>
      <h3>{canvas.canvasData?.title}</h3>
      <button onClick={handleAction}>Take Action</button>
    </div>
  );
}
```

### Step 2: Test Standalone

```typescript
import { MockCanvasProvider } from '@botdojo/chat-sdk';
import { MyCanvas } from './MyCanvas';

export default function TestMyCanvas() {
  return (
    <MockCanvasProvider
      mockCanvasData={{ title: 'Test Canvas' }}
      onSendMessage={async (text) => {
        console.log('Message:', text);
        return { success: true };
      }}
    >
      <MyCanvas />
    </MockCanvasProvider>
  );
}
```

### Step 3: Use in Production

```typescript
// In your chat message renderer
<BotDojoCanvasProvider
  canvasData={message.canvas.data}
  connector={connector}
>
  <MyCanvas />
</BotDojoCanvasProvider>
```

## Agent Tool Integration

Agents can create canvas cards by returning canvas data in tool responses:

```typescript
{
  name: 'showProduct',
  description: 'Show a product card',
  arguments: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      price: { type: 'number' },
      description: { type: 'string' }
    }
  },
  execute: async (params) => {
    return {
      success: true,
      canvas: {
        type: 'product-card',
        data: params
      }
    };
  }
}
```

## Canvas Event System

Listen to events from the canvas:

```typescript
const canvas = useBotDojoCanvas();

useEffect(() => {
  const unsubscribe = canvas.on('message', (data) => {
    console.log('Message received:', data);
  });
  
  return unsubscribe;
}, [canvas]);
```

Available events:
- `canvas:ready` - Canvas is ready
- `canvas:update` - Canvas data updated
- `message` - Message sent/received
- `token` - Token streamed
- `complete` - Flow complete
- `error` - Error occurred
- `mcp-ui:render-data` - MCP-UI lifecycle render payload arrived
- `mcp-ui:message-received` / `mcp-ui:message-response` - messageId ack/response events
- `mcp-ui:botdojo-tool-update` - BotDojo streaming extension (tool phase/patch)

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  BotDojoCanvasProviderProps,
  MockCanvasProviderProps,
  UseBotDojoCanvasReturn,
  CanvasEvent,
  BotDojoConnector
} from '@botdojo/chat-sdk';
```

## Best Practices

1. **Always check canvas.isReady before rendering**
   ```typescript
   if (!canvas.isReady) return <div>Loading...</div>;
   ```

2. **Handle missing data gracefully**
   ```typescript
   if (!canvas.canvasData) return <div>No data</div>;
   ```

3. **Use MockCanvasProvider for development**
   - Faster iteration
   - No chat widget needed
   - Easy to test different states

4. **Keep canvas components simple**
   - Single responsibility
   - Minimal state
   - Reusable across different contexts

5. **Test with mock before production**
   - Verify all interactions
   - Test error states
   - Check loading states

## Troubleshooting

### "useBotDojoCanvas must be used within BotDojoCanvasProvider or MockCanvasProvider"

Make sure your component is wrapped in one of the providers:

```typescript
<MockCanvasProvider mockCanvasData={{...}}>
  <YourCanvas />
</MockCanvasProvider>
```

### Canvas data is null

Check that you're passing canvasData to the provider:

```typescript
<BotDojoCanvasProvider canvasData={yourData}>
  ...
</BotDojoCanvasProvider>
```

### sendMessage not working

In production, ensure connector is passed:

```typescript
<BotDojoCanvasProvider
  canvasData={data}
  connector={connector}  // ← Make sure this is passed
>
```

In mock mode, ensure onSendMessage is provided:

```typescript
<MockCanvasProvider
  mockCanvasData={data}
  onSendMessage={async (text) => { /* handler */ }}  // ← Provide this
>
```

## Examples

See `apps/chat-embed-test/pages/canvas-render.tsx` for a complete working example.
