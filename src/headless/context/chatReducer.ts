/**
 * Chat Reducer
 * 
 * State management for Headless Chat. This reducer accumulates events from
 * the iframe into a simple messages array. Each event is a small update that
 * gets merged into the existing state.
 */

import { 
  HeadlessChatState, 
  HeadlessAction, 
  ChatMessage 
} from '../types/headless';
import { FlowRequestStep } from '@botdojo/sdk-types';

export const initialState: HeadlessChatState = {
  isReady: false,
  error: null,
  messages: [],
  status: 'idle',
  sessionId: null,
};

/**
 * Find or create a step in a message's steps array
 */
function findOrCreateStep(
  steps: FlowRequestStep[],
  stepId: string,
  parentStepId?: string
): FlowRequestStep {
  // Try to find existing step
  let step = steps.find(s => s.stepId === stepId);
  if (step) return step;
  
  // If has parent, look in parent's subSteps
  if (parentStepId) {
    const parent = steps.find(s => s.stepId === parentStepId);
    if (parent) {
      if (!parent.subSteps) {
        parent.subSteps = [];
      }
      step = parent.subSteps.find(s => s.stepId === stepId);
      if (step) return step;
      
      // Create new sub-step
      const newStep: FlowRequestStep = {
        stepId,
        stepLabel: '',
        stepStatus: 'processing',
        content: '',
        startTime: new Date(),
        parentStepId,
      };
      parent.subSteps.push(newStep);
      return newStep;
    }
  }
  
  // Create new top-level step
  const newStep: FlowRequestStep = {
    stepId,
    stepLabel: '',
    stepStatus: 'processing',
    content: '',
    startTime: new Date(),
    parentStepId,
  };
  steps.push(newStep);
  return newStep;
}

/**
 * Merge step update into existing step
 */
function mergeStep(
  existing: FlowRequestStep,
  update: FlowRequestStep
): FlowRequestStep {
  // Deep merge canvas to preserve resolved html/url that was added by BotDojoChatProvider
  // Without this, a step completion update could overwrite the canvas with one that lacks html
  let mergedCanvas = existing.canvas;
  if (update.canvas) {
    mergedCanvas = {
      ...existing.canvas,
      ...update.canvas,
      canvasData: {
        ...existing.canvas?.canvasData,
        ...update.canvas?.canvasData,
        // CRITICAL: Preserve html if the update doesn't have it
        // BotDojoChatProvider resolves ui:// URLs and adds html to canvasData
        // Subsequent step updates may not have html, so we must preserve it
        html: update.canvas?.canvasData?.html ?? existing.canvas?.canvasData?.html,
        // Also preserve url if not in update
        url: update.canvas?.canvasData?.url ?? existing.canvas?.canvasData?.url,
      },
    } as typeof existing.canvas;
  }
  
  return {
    ...existing,
    ...update,
    // Preserve fields that shouldn't be overwritten by partial updates
    stepId: existing.stepId,
    startTime: existing.startTime,
    subSteps: update.subSteps || existing.subSteps,
    canvas: mergedCanvas,
  };
}

export function chatReducer(
  state: HeadlessChatState,
  action: HeadlessAction
): HeadlessChatState {
  switch (action.type) {
    case 'READY':
      return {
        ...state,
        isReady: true,
        error: null,
      };
    
    case 'ERROR':
      return {
        ...state,
        error: action.error,
        status: 'error',
      };
    
    case 'SET_SESSION':
      return {
        ...state,
        sessionId: action.sessionId,
      };
    
    case 'MESSAGE_START': {
      // Create new message
      const newMessage: ChatMessage = {
        id: action.messageId,
        role: action.role as 'user' | 'assistant' | 'system',
        content: '',
        timestamp: new Date(),
        status: action.role === 'user' ? 'sending' : 'streaming',
        steps: [],
      };
      
      return {
        ...state,
        messages: [...state.messages, newMessage],
        status: action.role === 'assistant' ? 'streaming' : state.status,
      };
    }
    
    case 'STEP_UPDATE': {
      // Find message and update/add step
      const messages = state.messages.map(msg => {
        if (msg.id !== action.messageId) return msg;
        
        // Clone steps array
        const steps = [...msg.steps];
        
        // Find or create step
        const step = findOrCreateStep(steps, action.step.stepId, action.step.parentStepId);
        
        // Merge update
        const stepIndex = steps.findIndex(s => s.stepId === action.step.stepId);
        if (stepIndex !== -1) {
          steps[stepIndex] = mergeStep(steps[stepIndex], action.step);
        }
        
        return { ...msg, steps };
      });
      
      return { ...state, messages };
    }
    
    case 'TOKEN': {
      // Accumulate token into appropriate place
      const { messageId, tokenUpdate } = action;
      
      const messages = state.messages.map(msg => {
        if (msg.id !== messageId) return msg;
        
        if (tokenUpdate.updateType === 'completion') {
          // Text token - append to message content
          return {
            ...msg,
            content: msg.content + tokenUpdate.token,
          };
        }
        
        // Note: Tool argument tokens (updateType === 'function') are no longer accumulated here.
        // Final tool arguments come via STEP_UPDATE with stepToolArguments already parsed.
        
        return msg;
      });
      
      return { ...state, messages };
    }
    
    case 'MESSAGE_COMPLETE': {
      // Mark message as complete
      const messages = state.messages.map(msg => {
        if (msg.id !== action.messageId) return msg;
        return {
          ...msg,
          content: action.content || msg.content,
          status: 'complete' as const,
        };
      });
      
      return {
        ...state,
        messages,
        status: 'idle',
      };
    }
    
    case 'REQUEST_ABORTED': {
      // Mark current streaming message as complete
      const messages = state.messages.map(msg => {
        if (msg.status === 'streaming') {
          return { ...msg, status: 'complete' as const };
        }
        return msg;
      });
      
      return {
        ...state,
        messages,
        status: 'idle',
      };
    }
    
    case 'SEND_MESSAGE': {
      // This action just triggers the send - actual message is added by MESSAGE_START
      return {
        ...state,
        status: 'loading',
      };
    }
    
    default:
      return state;
  }
}
