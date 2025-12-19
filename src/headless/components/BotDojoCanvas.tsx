import React, { useEffect, useRef } from 'react';

/**
 * Canvas type for the chat SDK.
 * Only 'mcp-app' is supported in the open-source SDK.
 */
export type FlowCanvasType = 'mcp-app';

export interface BotDojoCanvasFrameProps {
  canvasId: string;
  canvasData: any;
  canvasType?: FlowCanvasType | string;
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
}

/**
 * Minimal headless canvas iframe renderer.
 * Renders mcp-app canvases by loading the URL or inline HTML.
 * 
 * Note: Only 'mcp-app' canvas type is supported in the open-source SDK.
 * Other canvas types will render nothing and emit a dev warning.
 */
export function BotDojoCanvasFrame(props: BotDojoCanvasFrameProps): JSX.Element | null {
  const { canvasId, canvasData, canvasType: explicitCanvasType, width = '100%', height = '400px', style = {} } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const canvasType = explicitCanvasType || canvasData?.canvasType || canvasData?.type || 'mcp-app';
  const actualData = canvasData?.canvasData || canvasData;

  // Only mcp-app is supported in the open-source SDK
  if (canvasType !== 'mcp-app') {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        `[BotDojoCanvasFrame] Canvas type "${canvasType}" is not supported. ` +
        `Only "mcp-app" canvases are supported in the open-source SDK.`
      );
    }
    return null;
  }

  useEffect(() => {
    // If inline HTML is provided, build a blob URL
    if (actualData?.html && iframeRef.current) {
      const blob = new Blob([actualData.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      iframeRef.current.src = url;
      return () => URL.revokeObjectURL(url);
    }
    if (actualData?.url && iframeRef.current) {
      iframeRef.current.src = actualData.url;
    }
  }, [actualData]);

  return (
    <iframe
      ref={iframeRef}
      title={canvasId}
      style={{ width, height, border: 'none', ...style }}
      sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
    />
  );
}
