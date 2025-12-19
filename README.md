# @botdojo/chat-sdk

Simple React component for embedding BotDojo AI chat into any application.

## Features

- 🚀 **Easy Integration** - Single React component
- 💬 **Four Display Modes** - Popup, side panel, side push, or inline
- 🎨 **Fully Customizable** - Colors, sizing, theming
- 🛠️ **Custom Tools** - Give your AI access to your app
- 📚 **Resource Support** - Serve content to the AI
- 🔐 **Secure** - API key-based authentication
- 🎯 **TypeScript** - Full type definitions

## Installation

```bash
npm install @botdojo/chat-sdk react
```

**Requirements:** React 17.0+ or React 18.0+

## Quick Start

### Basic Chat

```tsx
import { BotDojoChat } from '@botdojo/chat-sdk';

function App() {
  return <BotDojoChat apiKey="YOUR_API_KEY" />;
}
```

That's it! You'll get a chat popup button in the bottom-right corner.

### Chat with Custom Tools

Give your AI the ability to interact with your application:

```tsx
import { BotDojoChat } from '@botdojo/chat-sdk';

function App() {
  return (
    <BotDojoChat
      apiKey="YOUR_API_KEY"
      modelContext={{
        name: 'myapp',
        description: 'My application tools',
        toolPrefix: 'app',
        tools: {
          get_page_title: {
            description: 'Get the current page title',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => document.title
          },
          scroll_to_section: {
            description: 'Scroll to a specific section',
            inputSchema: {
              type: 'object',
              properties: {
                section: { type: 'string', description: 'Section ID' }
              },
              required: ['section']
            },
            execute: async (args: { section: string }) => {
              const element = document.getElementById(args.section);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth' });
                return `Scrolled to ${args.section}`;
              }
              return 'Section not found';
            }
          }
        }
      }}
    />
  );
}
```

## Display Modes

### Chat Popup (Default)

```tsx
<BotDojoChat apiKey="YOUR_API_KEY" mode="chat-popup" />
```

Floating button in bottom-right corner. **Best for:** Most websites, minimal intrusion.

### Side Panel

```tsx
<BotDojoChat apiKey="YOUR_API_KEY" mode="side-panel" />
```

Slides in from the side, overlays content. **Best for:** Documentation sites, support portals.

### Side Push

```tsx
<BotDojoChat apiKey="YOUR_API_KEY" mode="side-push" />
```

Slides in from the side, pushes content. **Best for:** Integrated layouts.

### Inline

```tsx
<BotDojoChat apiKey="YOUR_API_KEY" mode="inline" width="100%" height="100%" />
```

Direct embed in the page. **Best for:** Dedicated chat pages, full-screen experiences.

## Customization

### Colors & Theme

```tsx
<BotDojoChat
  apiKey="YOUR_API_KEY"
  accentColor="#ff6b6b"
  backgroundColor="#f5f5f5"
  theme="dark"
  fontSize="16px"
/>
```

### Popup Options

```tsx
<BotDojoChat
  apiKey="YOUR_API_KEY"
  mode="chat-popup"
  popupOptions={{
    width: '500px',
    height: '700px',
    resizable: true,
    minWidth: '350px',
    maxWidth: '800px'
  }}
/>
```

### Side Panel Options

```tsx
<BotDojoChat
  apiKey="YOUR_API_KEY"
  mode="side-panel"
  sidePanelOptions={{
    direction: 'left',
    defaultWidth: '450px',
    resizable: true,
    minWidth: '300px',
    maxWidth: '1000px'
  }}
/>
```

## Key Props

| Prop | Type | Description |
|------|------|-------------|
| `apiKey` | `string` | **Required.** Your BotDojo API key |
| `mode` | `'chat-popup' \| 'side-panel' \| 'side-push' \| 'inline'` | Display mode. Default: `'chat-popup'` |
| `modelContext` | `ModelContext` | Define tools (with `execute` functions) and resources for the AI |
| `accentColor` | `string` | Primary color. Default: `'#4a3ed4'` |
| `backgroundColor` | `string` | Background color. Default: `'#ffffff'` |
| `theme` | `'light' \| 'dark'` | Theme mode. Default: `'light'` |
| `width` | `string` | Container width. CSS value |
| `height` | `string` | Container height. CSS value |
| `popupOptions` | `PopupOptions` | Popup-specific configuration |
| `sidePanelOptions` | `SidePanelOptions` | Side panel configuration |
| `flowHeaders` | `object` | Custom headers for flow execution |
| `sessionId` | `string` | Specific session ID to use/resume |
| `newSession` | `boolean` | Force new session. Default: `false` |
| `allowMicrophone` | `boolean` | Enable voice input. Default: `false` |
| `onLoad` | `() => void` | Called when iframe loads |
| `onOpen` | `() => void` | Called when chat opens |
| `onClose` | `() => void` | Called when chat closes |
| `onBotDojoChatControl` | `(control) => void` | Receive control methods |

## Real-World Examples

### E-commerce Assistant

```tsx
function Shop() {
  const [cart, setCart] = useState([]);

  return (
    <BotDojoChat
      apiKey="YOUR_KEY"
      mode="side-panel"
      accentColor="#2563eb"
      modelContext={{
        name: 'shop',
        description: 'E-commerce store assistant',
        toolPrefix: 'shop',
        tools: {
          add_to_cart: {
            description: 'Add a product to the shopping cart',
            parameters: {
              type: 'object',
              properties: {
                productId: { type: 'string', description: 'Product ID' },
                quantity: { type: 'number', description: 'Quantity' }
              },
              required: ['productId', 'quantity']
            },
            execute: async ({ productId, quantity }) => {
              const product = await fetchProduct(productId);
              setCart([...cart, { product, quantity }]);
              return { 
                success: true, 
                message: `Added ${quantity}x ${product.name}` 
              };
            }
          }
        }
      }}
    />
  );
}
```

### Documentation Helper

```tsx
function Docs() {
  return (
    <BotDojoChat
      apiKey="YOUR_KEY"
      mode="chat-popup"
      modelContext={{
        name: 'docs',
        description: 'Documentation assistant',
        toolPrefix: 'docs',
        tools: {
          search_docs: {
            description: 'Search the documentation',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              },
              required: ['query']
            },
            execute: async ({ query }) => {
              const results = await docsSearch(query);
              return { results };
            }
          }
        },
        resources: [
          {
            name: 'getting_started',
            uri: 'resource://docs/getting-started',
            mimeType: 'text/markdown',
            description: 'Getting started guide',
            getContent: async () => '# Getting Started\n\n...'
          }
        ]
      }}
    />
  );
}
```

## Programmatic Control

```tsx
function App() {
  const [chatControl, setChatControl] = useState<BotDojoChatControl | null>(null);

  return (
    <>
      <button onClick={() => chatControl?.openChat()}>Open Chat</button>
      <button onClick={() => chatControl?.sendFlowRequest({ message: 'Hello!' })}>
        Send Message
      </button>
      
      <BotDojoChat
        apiKey="YOUR_KEY"
        modelContext={{...}}
        onBotDojoChatControl={setChatControl}
      />
    </>
  );
}
```

## TypeScript

Full TypeScript support:

```typescript
import { 
  BotDojoChat, 
  BotDojoChatProps, 
  ModelContext,
  BotDojoChatControl
} from '@botdojo/chat-sdk';
```

## Migration from botdojo-embed.js

**Before (HTML + Script):**
```html
<script src="botdojo-embed.js" 
  data-iframe-url="https://embed.botdojo.com/embed/chat?key=KEY"
  data-accent-color="#4a3ed4">
</script>
```

**After (React Component):**
```tsx
import { BotDojoChat } from '@botdojo/chat-sdk';

<BotDojoChat apiKey="KEY" mode="chat-popup" accentColor="#4a3ed4" />
```

## Canvas Components

### Building Interactive Canvas Cards

Canvas cards are React components that render inline in the chat message stream. They can send messages back to the agent, display rich content, and execute tools in the parent application.

#### Basic Canvas Component

```tsx
import { useBotDojoCanvas } from '@botdojo/chat-sdk';

function ProductCard() {
  const canvas = useBotDojoCanvas();
  const [quantity, setQuantity] = useState(1);

  const handleAddToCart = async () => {
    // Call a tool in the parent application
    await canvas.connector.executeToolCall('addToCart', {
      product_id: canvas.canvasData?.id,
      quantity
    });
  };

  const handleAskAI = async () => {
    // Send a message to the AI agent
    await canvas.sendMessage(`Tell me more about ${canvas.canvasData?.name}`);
  };

  if (!canvas.canvasData) return null;

  return (
    <div style={{ padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
      <h3>{canvas.canvasData.name}</h3>
      <p style={{ color: '#10b981', fontSize: '24px', fontWeight: 'bold' }}>
        ${canvas.canvasData.price}
      </p>
      <p>{canvas.canvasData.description}</p>
      
      <input
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(parseInt(e.target.value))}
        min="1"
      />
      
      <button onClick={handleAddToCart} disabled={!canvas.isReady}>
        Add to Cart
      </button>
      
      <button onClick={handleAskAI} disabled={!canvas.connector}>
        Ask AI
      </button>
    </div>
  );
}
```

#### Rendering Canvas in Your App

To display canvas content, wrap your component in `BotDojoCanvasProvider`:

```tsx
import { BotDojoCanvasProvider } from '@botdojo/chat-sdk';
import { ProductCard } from './ProductCard';

function CanvasRenderer() {
  const router = useRouter();
  
  // Parse canvas data from URL or props
  const canvasData = {
    id: router.query.product_id,
    name: router.query.name,
    price: router.query.price,
    description: router.query.description,
  };
  
  return (
    <BotDojoCanvasProvider canvasData={canvasData} debug={true}>
      <ProductCard />
    </BotDojoCanvasProvider>
  );
}
```

#### Creating Canvas from Agent Tools

Agent tools can create canvas cards by returning canvas data:

```tsx
const modelContext = {
  name: 'shop',
  tools: [
    {
      name: 'showProductCard',
      description: 'Display a product card in the chat',
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'string' }
        },
        required: ['product_id']
      },
      execute: async ({ product_id }) => {
        const product = await fetchProduct(product_id);
        
        // Build URL to your canvas renderer
        const canvasUrl = new URL('https://yourapp.com/canvas-render');
        canvasUrl.searchParams.set('type', 'product-card');
        canvasUrl.searchParams.set('product_id', product.id);
        canvasUrl.searchParams.set('name', product.name);
        canvasUrl.searchParams.set('price', product.price);
        canvasUrl.searchParams.set('description', product.description);
        
        return {
          success: true,
          _canvas: {
            canvasId: null,
            canvasType: 'dojo-canvas',
            canvasData: {
              url: canvasUrl.toString(),
              type: 'product-card',
              product: product,
              show_inline: true,
              height: '400px',
              agent_enabled: true,
            }
          }
        };
      }
    }
  ]
};
```

#### Canvas Hook API

The `useBotDojoCanvas` hook provides:

```typescript
const canvas = useBotDojoCanvas();

// Properties
canvas.isReady        // boolean - whether canvas is initialized
canvas.error          // Error | null - any initialization error
canvas.canvasData     // any - data passed to this canvas card
canvas.connector      // BotDojoConnector | null - connection to parent
canvas.isMockMode     // boolean - true when using MockCanvasProvider

// Methods
await canvas.sendMessage(text, params)          // Send message to agent
await canvas.connector.executeToolCall(name, args)  // Call parent tool
const unsubscribe = canvas.on(event, handler)   // Listen to events
```

#### Canvas Events

Listen to canvas events:

```tsx
useEffect(() => {
  const unsubscribe = canvas.on('message', (data) => {
    console.log('Message received:', data);
  });
  
  return unsubscribe;
}, [canvas]);
```

Available events: `canvas:ready`, `canvas:update`, `message`, `token`, `complete`, `error`

#### Testing Canvas Components

Use `MockCanvasProvider` for standalone development:

```tsx
import { MockCanvasProvider } from '@botdojo/chat-sdk';
import { ProductCard } from './ProductCard';

function TestPage() {
  return (
    <MockCanvasProvider
      mockCanvasData={{
        id: 'test-product',
        name: 'Test Product',
        price: '99.99',
        description: 'A test product'
      }}
      onSendMessage={async (text) => {
        console.log('Would send:', text);
        return { success: true };
      }}
      debug={true}
    >
      <ProductCard />
    </MockCanvasProvider>
  );
}
```

See the [SDK Playground](https://github.com/botdojo-ai/chat-sdk-playground) for complete working examples.

## Headless Chat (Custom UI)

Build your own chat UI with full design control using the Provider + Hooks pattern.

### Basic Headless Example

```tsx
import {
  BotDojoChatProvider,
  useChatMessages,
  useChatActions,
  useChatStatus,
} from '@botdojo/chat-sdk';

// Your custom chat UI
function ChatUI() {
  const { messages, isStreaming } = useChatMessages();
  const { sendMessage, abortRequest } = useChatActions();
  const { status, isReady } = useChatStatus();
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && isReady) {
      sendMessage(input);
      setInput('');
    }
  };

  return (
    <div className="chat-container">
      {/* Message list */}
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <p>{msg.content}</p>
            {msg.status === 'streaming' && <span className="typing">...</span>}
          </div>
        ))}
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={!isReady || isStreaming}
        />
        {isStreaming ? (
          <button type="button" onClick={abortRequest}>Stop</button>
        ) : (
          <button type="submit" disabled={!input.trim()}>Send</button>
        )}
      </form>
    </div>
  );
}

// Wrap with provider
function App() {
  return (
    <BotDojoChatProvider apiKey="YOUR_API_KEY">
      <ChatUI />
    </BotDojoChatProvider>
  );
}
```

### Headless with Frontend MCP (Model Context)

Give your AI access to tools that run in the browser:

```tsx
import { 
  BotDojoChatProvider, 
  useChatMessages, 
  useChatActions,
  type ModelContext 
} from '@botdojo/chat-sdk';

function WeatherChat() {
  // Define tools that run in the browser
  const modelContext: ModelContext = {
    name: 'weather_service',
    description: 'Provides live weather information',
    toolPrefix: 'weather',
    uri: 'weather://context',
    tools: [
      {
        name: 'get_weather',
        description: 'Get weather for a city',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' }
          },
          required: ['city']
        },
        execute: async ({ city }) => {
          // Fetch real weather data
          const response = await fetch(`/api/weather?city=${city}`);
          const data = await response.json();
          return {
            temperature: data.temp,
            conditions: data.conditions,
          };
        }
      }
    ]
  };

  return (
    <BotDojoChatProvider 
      apiKey="YOUR_API_KEY"
      modelContext={modelContext}
    >
      <CustomChatUI />
    </BotDojoChatProvider>
  );
}
```

### Available Hooks

| Hook | Description |
|------|-------------|
| `useBotDojoChat()` | Combined state and actions |
| `useChatMessages()` | Access `messages`, `currentMessage`, `isStreaming` |
| `useChatActions()` | Access `sendMessage`, `abortRequest`, `bargeInRequest`, `setSessionId`, `reload` |
| `useChatStatus()` | Access `status`, `isReady`, `error`, `sessionId` |

### Provider Props

| Prop | Type | Description |
|------|------|-------------|
| `apiKey` | `string` | **Required.** Your BotDojo API key |
| `modelContext` | `ModelContext \| ModelContext[]` | Tools and resources for the AI |
| `baseUrl` | `string` | BotDojo embed URL. Default: auto-detected |
| `sessionId` | `string` | Resume a specific session |
| `newSession` | `boolean` | Force new session. Default: `false` |
| `debug` | `boolean` | Enable debug mode for MCP Apps |
| `onReady` | `() => void` | Called when provider is ready |
| `onError` | `(error: Error) => void` | Called on errors |
| `onSessionCreated` | `(sessionId: string) => void` | Called when session is created |
| `onOpenLink` | `(url, target, appId) => void` | Handle MCP App link requests |
| `onToolCall` | `(tool, params, appId) => Promise<any>` | Handle MCP App tool calls |
| `onUiMessage` | `(message, params, appId) => void` | Handle MCP App messages |

### Rendering MCP Apps in Headless Mode

When tools return UI (MCP Apps), render them using `McpAppHost`:

```tsx
import { useChatMessages, McpAppHost, extractMcpAppData } from '@botdojo/chat-sdk';

function MessageList() {
  const { messages } = useChatMessages();

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          <p>{msg.content}</p>
          
          {/* Render MCP Apps from message steps */}
          {msg.steps.map((step) => {
            const mcpApp = extractMcpAppData(step, { 
              isComplete: msg.status === 'complete' 
            });
            if (!mcpApp) return null;
            
            return (
              <McpAppHost
                key={mcpApp.mcpAppId}
                mcpAppId={mcpApp.mcpAppId}
                mcpAppData={mcpApp}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

## Links

- [Documentation](https://docs.botdojo.com)
- [Website](https://botdojo.com)
- [Get API Key](https://app.botdojo.com)
- [NPM Package](https://www.npmjs.com/package/@botdojo/chat-sdk)
- [SDK Playground](https://github.com/botdojo-ai/chat-sdk-playground) - Live examples

## License

MIT
