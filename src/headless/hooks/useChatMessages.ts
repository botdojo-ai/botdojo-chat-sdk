/**
 * useChatMessages Hook
 * 
 * Provides access to messages array and streaming state
 */

import { useContext, useMemo } from 'react';
import { BotDojoChatContext } from '../context/BotDojoChatProvider';
import { ChatMessagesHook } from '../types/headless';

export function useChatMessages(): ChatMessagesHook {
  const context = useContext(BotDojoChatContext);
  
  if (!context) {
    throw new Error('useChatMessages must be used within BotDojoChatProvider');
  }

  const { state } = context;

  // Find currently streaming message
  const currentMessage = useMemo(() => {
    return state.messages.find(m => m.status === 'streaming') || null;
  }, [state.messages]);

  // Check if streaming
  const isStreaming = state.status === 'streaming';

  return {
    messages: state.messages,
    currentMessage,
    isStreaming,
  };
}
