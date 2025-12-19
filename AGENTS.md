# @botdojo/chat-sdk — Agents Guide

## Purpose

This package provides a single, unified React component (`BotDojoChat`) for embedding BotDojo chat into any application. It simplifies the embedding experience by requiring only an API key, with optional model context integration for tool calls and resources.

**Key responsibilities:**
- React component for embedding BotDojo chat
- Four display modes: popup, side panel, side push, inline
- Optional model context integration for tools/resources
- Automatic connector lifecycle management
- PostMessage-based communication (no WebSocket needed for basic embedding)

## Key entry points

- Source root: `packages/sdk-chat/src/`
- Main component: `packages/sdk-chat/src/BotDojoChat.tsx`
- Exports: `packages/sdk-chat/src/index.tsx`

## Where to edit what

### Add/modify the main component
- Edit `src/BotDojoChat.tsx`

### Add new props or types
- Add to `BotDojoChatProps` interface in `src/BotDojoChat.tsx`
- Props are fully documented with JSDoc

### Change display modes
- Edit the styling functions in `src/BotDojoChat.tsx`:
  - `getContainerStyles()` - Container positioning
  - `getChatStyles()` - Chat window styling
  - `getButtonStyles()` - Button styling

### Update exports
- Edit `src/index.tsx`

### Change build configuration
- Edit `tsup.config.ts` for build settings
- Edit `tsconfig.json` for TypeScript settings

## Run & test

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Watch mode for development
pnpm dev

# Clean build artifacts
pnpm clean
```

## Dependencies

### Bundled Dependencies (Not Exposed)
- **botdojo-canvas-client**: Core connector and model context types (bundled)
- **botdojo-rpc**: PostMessage bridge for iframe communication (bundled)

### Peer Dependencies (User Must Install)
- **react**: React 17.0+ or React 18.0+ (peer dependency)

**Note:** All internal BotDojo packages (`botdojo-canvas-client`, `botdojo-rpc`, `botdojo-sdk-types`) are bundled into the published package. Users only need to install React.

## Component API

### Minimal usage (no tools)
```tsx
<BotDojoChat apiKey="YOUR_KEY" />
```

### With model context
```tsx
<BotDojoChat
  apiKey="YOUR_KEY"
  modelContext={{...}}
  toolCalls={{...}}
/>
```

## Architecture

### Component Structure
```
BotDojoChat
├── Iframe embedding (chat UI)
├── Button (for popup/side-panel modes)
├── BotDojoConnector (optional, for model context)
│   ├── Model context registration
│   ├── Tool call handling
│   └── Resource serving
└── PostMessage bridge (iframe ↔ parent communication)
```

### When Connector is Created
- Only when `modelContext` OR `toolCalls` are provided
- Otherwise, it's just a simple iframe embed

### ID Requirements
- **API Key**: ALWAYS required (only required prop)
- The API key contains all the flow configuration needed
- No need for accountId/projectId/flowId - these are hardcoded for embedded mode

### Transport Mode
- **postmessage**: Iframe-based communication, no WebSocket needed
- This is the only supported transport mode for BotDojoChat
- For advanced RPC needs, use BotDojoConnector directly

## Patterns & conventions

### Props naming
- Use camelCase for prop names
- Follow React conventions
- Document all props with JSDoc

### Display modes
- `chat-popup`: Default, floating button + popup
- `side-panel`: Slides in from right (overlay)
- `side-push`: Slides in from side, pushes content
- `inline`: Direct embed at component location

### Model context
- `modelContext`: Defines tools, prompts, resources
- `toolCalls`: Implements the tool functions
- Tool implementations receive args and return results (async)

### Error handling
- Show error UI if connector initialization fails
- Log errors with `[BotDojoChat]` prefix
- Cleanup on unmount (close connector, stop bridges)

## External APIs / endpoints

This package uses:
- **BotDojoConnector** from `botdojo-canvas-client`
  - `init()`: Initialize connector
  - `close()`: Cleanup
  - `setModelContext()`: Update context
  - `setToolCalls()`: Update tool handlers
  - `getExternalUIChannelId()`: Get channel ID for iframe
  - `updatePostMessageTarget()`: Set target window

- **PostMessageBridge** from `botdojo-rpc`
  - `createIframeBridge()`: Create bridge to iframe
  - `start()`, `stop()`: Lifecycle
  - `sendMessage()`: Send messages

## Troubleshooting

### Connector fails to initialize
- Check that API key is valid
- For RPC mode, ensure accountId/projectId/flowId are provided
- Check console for detailed error messages

### Tool calls not working
- Ensure `modelContext` includes tool definitions
- Ensure `toolCalls` has matching implementations
- Check that tool names match exactly

### Iframe not loading
- Verify API key is valid and contains flow configuration
- Check browser console for iframe errors
- Ensure the base URL is correct (localhost:3000 for dev, embed.botdojo.com for prod)

### PostMessage bridge not connecting
- Ensure iframe has loaded (`onLoad` callback)
- Check for CORS issues if custom domain
- Verify target window is set correctly

## Improving this document

If you find gaps or mistakes, edit this file directly and propose changes.

