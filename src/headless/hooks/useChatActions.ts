/**
 * useChatActions Hook
 * 
 * Provides action dispatchers for controlling chat
 */

import { useContext, useCallback } from 'react';
import { BotDojoChatContext } from '../context/BotDojoChatProvider';
import { ChatActionsHook } from '../types/headless';

export function useChatActions(): ChatActionsHook {
  const context = useContext(BotDojoChatContext);
  
  if (!context) {
    throw new Error('useChatActions must be used within BotDojoChatProvider');
  }

  const { dispatch, iframeRef } = context;

  // Send message to iframe
  const sendMessage = useCallback((text: string) => {
    if (!iframeRef.current?.contentWindow) {
      console.error('[useChatActions] Iframe not ready');
      return;
    }

    dispatch({ type: 'SEND_MESSAGE', text });
    
    iframeRef.current.contentWindow.postMessage(
      { type: 'send_message', text_input: text },
      '*'
    );
  }, [dispatch, iframeRef]);

  // Abort current request
  const abortRequest = useCallback(() => {
    if (!iframeRef.current?.contentWindow) {
      console.error('[useChatActions] Iframe not ready');
      return;
    }

    iframeRef.current.contentWindow.postMessage(
      { type: 'abort_request' },
      '*'
    );
  }, [iframeRef]);

  // Barge in (abort + send new)
  const bargeInRequest = useCallback((text: string) => {
    abortRequest();
    // Small delay to ensure abort is processed
    setTimeout(() => sendMessage(text), 100);
  }, [abortRequest, sendMessage]);

  // Load session history
  const setSessionId = useCallback((sessionId: string) => {
    if (!iframeRef.current?.contentWindow) {
      console.error('[useChatActions] Iframe not ready');
      return;
    }

    iframeRef.current.contentWindow.postMessage(
      { type: 'set_session_id', sessionId },
      '*'
    );
  }, [iframeRef]);

  // Reload iframe
  const reload = useCallback(() => {
    if (!iframeRef.current) {
      console.error('[useChatActions] Iframe not available');
      return;
    }

    iframeRef.current.src = iframeRef.current.src;
  }, [iframeRef]);

  // Persist MCP App state to server
  const persistAppState = useCallback((appId: string, state: Record<string, any>) => {
    if (!iframeRef.current?.contentWindow) {
      console.error('[useChatActions] Iframe not ready');
      return;
    }

    console.log('[useChatActions] Persisting MCP App state:', appId, state);
    iframeRef.current.contentWindow.postMessage(
      { type: 'persist_app_state', appId, state },
      '*'
    );
  }, [iframeRef]);

  return {
    sendMessage,
    abortRequest,
    bargeInRequest,
    setSessionId,
    reload,
    persistAppState,
  };
}
