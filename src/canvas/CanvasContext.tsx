import { createContext } from 'react';
import type { CanvasContextValue } from './types';

/**
 * @deprecated Use `useMcpApp` from `mcp-app-view/react` instead.
 * This context will be removed in a future version.
 * 
 * Migration:
 * ```tsx
 * // Before
 * import { BotDojoCanvasProvider, useBotDojoCanvas } from '@botdojo/chat-sdk';
 * 
 * // After
 * import { useMcpApp } from 'mcp-app-view/react';
 * ```
 */
export const CanvasContext = createContext<CanvasContextValue | null>(null);
