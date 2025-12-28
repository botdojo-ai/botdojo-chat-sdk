# Tool Patterns Guide

Best practices for defining and implementing tools in ModelContext.

## Tool Structure

```typescript
{
  name: 'toolName',
  description: 'What the tool does and when to use it.',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Parameter description.' }
    },
    required: ['param1']
  },
  _meta: {
    'botdojo/display-name': 'Human-Readable Name',
    ui: {
      resourceUri: 'ui://context/app-name',
      prefersProxy: true
    }
  },
  execute: async (params, context) => {
    // Implementation
    return { result: 'value' };
  }
}
```

## Tool Descriptions

Tool descriptions guide the AI's behavior. Be specific about:
- What the tool does
- When to use it
- What it returns

```typescript
// ✅ Good: Specific and actionable
description: 'Enhance a product description to be more compelling. Returns the enhanced text for preview before applying.'

// ❌ Bad: Vague
description: 'Enhance description.'
```

## Using Refs for Current State

Tool execute functions inside `useMemo` capture state from when the memo was created. Use refs to access current values:

```typescript
const [document, setDocument] = useState('');
const documentRef = useRef(document);

// Keep ref in sync with state
useEffect(() => {
  documentRef.current = document;
}, [document]);

const modelContext = useMemo(() => ({
  tools: [{
    name: 'getDocument',
    execute: async () => {
      // ✅ Always gets current value
      return { content: documentRef.current };
    }
  }]
}), []);  // Empty deps - tools use refs
```

**Why refs are necessary:**

```typescript
// ❌ Problem: Stale closure
const modelContext = useMemo(() => ({
  tools: [{
    execute: async () => {
      return { content: document };  // Captures initial value!
    }
  }]
}), []);  // document not in deps

// ✅ Solution: Use refs
const modelContext = useMemo(() => ({
  tools: [{
    execute: async () => {
      return { content: documentRef.current };  // Always current
    }
  }]
}), []);
```

## Linking Tools to MCP Apps

To render a custom UI when a tool is called, link it to a resource:

```typescript
tools: [{
  name: 'suggestChanges',
  _meta: {
    ui: {
      // Must exactly match a resource URI
      resourceUri: 'ui://my-context/review-panel',
      prefersProxy: true
    }
  },
  execute: async (params) => ({ changes: params.text })
}],
resources: [{
  // Must exactly match the tool's resourceUri
  uri: 'ui://my-context/review-panel',
  mimeType: 'text/html;profile=mcp-app',
  getContent: async () => ({
    uri: 'ui://my-context/review-panel',
    mimeType: 'text/html;profile=mcp-app',
    text: '<html>...</html>'
  })
}]
```

## Streaming Data to MCP Apps

Use `notifyToolInputPartial` to send data to the MCP App during execution:

```typescript
execute: async (params, context) => {
  // Send streaming update
  context?.notifyToolInputPartial?.({
    status: 'processing',
    progress: 50
  });
  
  // Do work...
  
  // Return final result
  return { result: 'done' };
}
```

The MCP App receives these via `onToolInputPartial`:

```typescript
const { tool } = useMcpApp({
  onToolInputPartial: (params) => {
    const args = params.arguments;
    console.log('Progress:', args.progress);
  }
});
```

## Functional State Updates

When tools update state, use functional updates to avoid race conditions:

```typescript
execute: async (params) => {
  // ✅ Functional update - always uses latest state
  setItems(prev => [...prev, params.newItem]);
  
  // ❌ May use stale state
  setItems([...items, params.newItem]);
  
  return { success: true };
}
```

## Hiding Tool Details

Use `botdojo/hide-step-details` to hide tool execution details in the chat:

```typescript
_meta: {
  'botdojo/display-name': 'Get Document',
  'botdojo/hide-step-details': true  // Don't show params/result in chat
}
```

Useful for:
- Read-only tools that fetch data
- Tools where the result is shown in an MCP App
- Internal tools that shouldn't clutter the conversation

## Tool Execution Context

The `execute` function receives a `ToolExecutionContext`:

```typescript
interface ToolExecutionContext {
  notifyToolInputPartial?: (data: unknown) => void;
  // Additional context may be available
}

execute: async (params, context?: ToolExecutionContext) => {
  // Use context for streaming
  context?.notifyToolInputPartial?.({ progress: 50 });
  
  return { result: 'done' };
}
```

## Example: Complete Tool Definition

```typescript
const modelContext: ModelContext = useMemo(() => ({
  name: 'product_editor',
  description: 'Tools for editing product information.',
  toolPrefix: 'product',
  uri: 'product://context',
  tools: [
    {
      name: 'getDescription',
      description: 'Get the current product description.',
      inputSchema: {
        type: 'object',
        properties: {
          productId: { type: 'string' }
        }
      },
      _meta: {
        'botdojo/display-name': 'Get Description',
        'botdojo/hide-step-details': true
      },
      execute: async () => ({
        description: descriptionRef.current
      })
    },
    {
      name: 'enhanceDescription',
      description: 'Propose an enhanced product description. Shows a preview before applying.',
      inputSchema: {
        type: 'object',
        properties: {
          enhanced_text: { 
            type: 'string',
            description: 'The enhanced description text.'
          }
        },
        required: ['enhanced_text']
      },
      _meta: {
        'botdojo/display-name': 'Enhance Description',
        ui: {
          resourceUri: 'ui://product/enhance-preview',
          prefersProxy: true
        }
      },
      execute: async (params, context) => {
        const payload = {
          original: descriptionRef.current,
          enhanced: params.enhanced_text
        };
        
        // Stream to MCP App
        context?.notifyToolInputPartial?.(payload);
        
        return payload;
      }
    },
    {
      name: 'applyDescription',
      description: 'Apply a new description to the product.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string' }
        },
        required: ['description']
      },
      _meta: {
        'botdojo/display-name': 'Apply Description',
        'botdojo/hide-step-details': true
      },
      execute: async (params) => {
        setDescription(params.description);
        return { success: true };
      }
    }
  ],
  resources: [
    {
      uri: 'ui://product/enhance-preview',
      name: 'Enhancement Preview',
      mimeType: 'text/html;profile=mcp-app',
      getContent: async () => ({
        uri: 'ui://product/enhance-preview',
        mimeType: 'text/html;profile=mcp-app',
        text: await fetchEnhancePreviewHtml()
      })
    }
  ]
}), []);
```


