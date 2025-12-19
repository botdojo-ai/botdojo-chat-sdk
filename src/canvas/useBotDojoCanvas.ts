import { useContext, useEffect } from 'react';
import { CanvasContext } from './CanvasContext';
import type { UseBotDojoCanvasReturn } from './types';

let hasWarnedDeprecation = false;

/**
 * @deprecated Use `useMcpApp` from `mcp-app-view/react` instead.
 * This hook will be removed in a future version.
 * 
 * Migration:
 * ```tsx
 * // Before
 * import { BotDojoCanvasProvider, useBotDojoCanvas } from '@botdojo/chat-sdk';
 * 
 * function MyCanvas() {
 *   const canvas = useBotDojoCanvas();
 *   // canvas.canvasData, canvas.toolPhase, etc.
 * }
 * 
 * // After
 * import { useMcpApp } from 'mcp-app-view/react';
 * 
 * function MyCanvas() {
 *   const { isInitialized, tool, hostContext, sendMessage, callTool } = useMcpApp({
 *     containerRef,
 *     autoReportSize: true,
 *   });
 *   // tool.arguments, tool.isStreaming, tool.result, etc.
 * }
 * ```
 */
export function useBotDojoCanvas(): UseBotDojoCanvasReturn {
  const context = useContext(CanvasContext);
  
  // Warn once about deprecation
  useEffect(() => {
    if (!hasWarnedDeprecation) {
      hasWarnedDeprecation = true;
      console.warn(
        '[DEPRECATED] useBotDojoCanvas is deprecated. ' +
        'Use useMcpApp from mcp-app-view/react instead. ' +
        'See migration guide: https://docs.botdojo.com/migration/mcp-apps'
      );
    }
  }, []);
  
  if (!context) {
    throw new Error('useBotDojoCanvas must be used within BotDojoCanvasProvider or MockCanvasProvider');
  }
  
  return context;
}
