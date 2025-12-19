/**
 * useChatStatus Hook
 * 
 * Provides chat status information
 */

import { useContext } from 'react';
import { BotDojoChatContext } from '../context/BotDojoChatProvider';
import { ChatStatusHook } from '../types/headless';

export function useChatStatus(): ChatStatusHook {
  const context = useContext(BotDojoChatContext);
  
  if (!context) {
    throw new Error('useChatStatus must be used within BotDojoChatProvider');
  }

  const { state } = context;

  return {
    status: state.status,
    isReady: state.isReady,
    error: state.error,
    sessionId: state.sessionId,
  };
}
