/**
 * useBotDojoChat Hook
 * 
 * Main hook that provides both state and actions
 */

import { useContext } from 'react';
import { BotDojoChatContext } from '../context/BotDojoChatProvider';
import { BotDojoChatHook } from '../types/headless';
import { useChatActions } from './useChatActions';

export function useBotDojoChat(): BotDojoChatHook {
  const context = useContext(BotDojoChatContext);
  
  if (!context) {
    throw new Error('useBotDojoChat must be used within BotDojoChatProvider');
  }

  const { state } = context;
  const actions = useChatActions();

  return {
    state: {
      status: state.status,
      isReady: state.isReady,
      error: state.error,
    },
    actions,
  };
}
