import { logger } from '@/lib/logger';
import type {
  ExecutivePrimaryDomain,
  ExecutiveTurnFeatures,
  ExecutiveWorkingState,
  ExecutiveWorkingStatePhase,
  ToolPackId,
} from './types';
import { extractUserFacingToolText } from './helpers';

function uniquePush(items: string[], value: string | null | undefined): string[] {
  if (!value || items.includes(value)) return items;
  return [...items, value];
}

function truncateFact(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 157)}...`;
}

function detectDraftMarkers(text: string): boolean {
  return /\bto:\s*\S+/i.test(text) && /\b(?:sub:|subject:)\s*\S+/i.test(text);
}

function mapPackToPrimaryDomain(packId: ToolPackId): ExecutivePrimaryDomain {
  switch (packId) {
    case 'calendar_mutation_pack':
      return 'calendar';
    case 'reminder_alert_pack':
      return 'reminder';
    case 'media_delivery_pack':
      return 'delivery';
    case 'settings_mutation_pack':
      return 'settings';
    case 'email_send_pack':
      return 'email_send';
    default:
      return 'context';
  }
}

function initialPhaseForPack(
  packId: ToolPackId,
  features: ExecutiveTurnFeatures,
): ExecutiveWorkingStatePhase {
  if (packId === 'email_send_pack') return 'act';
  if (packId === 'reminder_alert_pack') return 'act';
  if (packId === 'media_delivery_pack') return 'act';
  if (packId === 'settings_mutation_pack') return 'act';
  if (packId === 'calendar_mutation_pack') {
    if (features.pendingCalendarChangePresent) {
      return features.pendingCalendarConfirmIntent || features.pendingCalendarCancelIntent
        ? 'act'
        : 'draft';
    }
    return 'draft';
  }
  return 'retrieve';
}

function initialNextStep(
  packId: ToolPackId,
  features: ExecutiveTurnFeatures,
): string | null {
  if (packId === 'email_send_pack') return 'Send the approved draft.';
  if (packId === 'reminder_alert_pack') {
    return 'Complete the requested reminder or alert action.';
  }
  if (packId === 'media_delivery_pack') {
    return 'Deliver the requested original file to the user safely.';
  }
  if (packId === 'settings_mutation_pack') {
    return 'Update the reply preference docs safely.';
  }
  if (packId === 'calendar_mutation_pack') {
    if (features.pendingCalendarChangePresent) {
      if (features.pendingCalendarConfirmIntent || features.pendingCalendarCancelIntent) {
        return 'Resolve the pending calendar change safely.';
      }
      return 'Revise the pending calendar plan safely.';
    }
    return 'Build one calendar change preview.';
  }
  return 'Gather the minimum safe context needed, then answer directly.';
}

function summarizeToolResult(toolName: string, result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return `${toolName} completed`;
  }

  const record = result as Record<string, unknown>;

  if (toolName === 'search_memory' && typeof record.count === 'number') {
    return `memory matches=${record.count}`;
  }

  if (toolName === 'search_inbox_context') {
    const matches = Array.isArray(record.matches) ? record.matches.length : null;
    return matches !== null ? `inbox matches=${matches}` : 'inbox context checked';
  }

  if (toolName === 'list_inbox_emails') {
    const items = Array.isArray(record.items) ? record.items.length : null;
    return items !== null ? `inbox listed=${items}` : 'inbox emails listed';
  }

  if (toolName === 'search_calendar') {
    const events = Array.isArray(record.events) ? record.events.length : null;
    return events !== null ? `calendar matches=${events}` : 'calendar searched';
  }

  if (toolName === 'check_calendar') {
    return 'calendar availability checked';
  }

  if (toolName === 'search_web') {
    const sources = Array.isArray(record.sources) ? record.sources.length : null;
    return sources !== null ? `web results=${sources}` : 'public web searched';
  }

  if (toolName === 'plan_calendar_change') {
    const pendingChange = record.pendingChange;
    if (pendingChange && typeof pendingChange === 'object') {
      const pendingId = (pendingChange as Record<string, unknown>).pendingId;
      return typeof pendingId === 'string'
        ? `pending calendar preview=${pendingId}`
        : 'pending calendar preview created';
    }
    return 'calendar plan evaluated';
  }

  if (toolName === 'commit_calendar_change') {
    return typeof record.status === 'string'
      ? `calendar commit=${record.status}`
      : 'calendar change resolved';
  }

  if (toolName === 'plan_mcp_action') {
    const pendingAction = record.pendingAction;
    if (pendingAction && typeof pendingAction === 'object') {
      const pendingId = (pendingAction as Record<string, unknown>).pendingId;
      return typeof pendingId === 'string'
        ? `pending mcp action=${pendingId}`
        : 'pending mcp action created';
    }
    return 'external action preview evaluated';
  }

  if (toolName === 'commit_mcp_action' || toolName === 'cancel_mcp_action') {
    return typeof record.status === 'string'
      ? `mcp action=${record.status}`
      : 'external action resolved';
  }

  if (toolName === 'send_email') {
    return record.success === true ? 'email sent' : 'email send attempted';
  }

  if (toolName === 'append_to_supermemory') {
    return record.stored === true ? 'memory stored' : 'memory store attempted';
  }

  if (
    [
      'add_email_alert',
      'update_email_alert',
      'remove_email_alert',
      'list_email_alerts',
      'add_reminder',
      'list_reminders',
      'snooze_reminder',
      'dismiss_reminder',
      'cancel_reminder',
      'manage_reply_preferences',
    ].includes(toolName)
  ) {
    return `${toolName} completed`;
  }

  return `${toolName} completed`;
}

function deriveFact(toolName: string, result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;

  if (toolName === 'search_memory') {
    const memories = record.memories;
    if (Array.isArray(memories) && memories[0] && typeof memories[0] === 'object') {
      const content = (memories[0] as Record<string, unknown>).content;
      return typeof content === 'string' ? truncateFact(content) : null;
    }
  }

  if (toolName === 'search_calendar' && typeof record.summary === 'string') {
    return truncateFact(record.summary);
  }

  if (toolName === 'search_web') {
    if (typeof record.summary === 'string' && record.summary.trim()) {
      return truncateFact(record.summary);
    }

    const sources = Array.isArray(record.sources) ? record.sources : [];
    const firstSource =
      sources[0] && typeof sources[0] === 'object' && !Array.isArray(sources[0])
        ? (sources[0] as Record<string, unknown>)
        : null;
    const title = typeof firstSource?.title === 'string' ? firstSource.title : null;
    const snippets = Array.isArray(firstSource?.snippets) ? firstSource.snippets : [];
    const firstSnippet = typeof snippets[0] === 'string' ? snippets[0] : null;
    if (title && firstSnippet) {
      return truncateFact(`${title}: ${firstSnippet}`);
    }
  }

  if (toolName === 'search_inbox_context' && typeof record.summary === 'string') {
    return truncateFact(record.summary);
  }

  if (toolName === 'list_inbox_emails' && typeof record.matchedCount === 'number') {
    return truncateFact(`Listed ${record.returnedCount ?? record.matchedCount} of ${record.matchedCount} matching inbox emails.`);
  }

  const genericContentRefs = Array.isArray(record.contentRefs) ? record.contentRefs : [];
  if (genericContentRefs.length > 0) {
    const firstReference = genericContentRefs[0];
    const firstName =
      firstReference &&
      typeof firstReference === 'object' &&
      typeof (firstReference as Record<string, unknown>).displayName === 'string'
        ? ((firstReference as Record<string, unknown>).displayName as string)
        : null;

    return truncateFact(
      `${toolName}: ${genericContentRefs.length} content reference(s) available${
        firstName ? `, starting with ${firstName}` : ''
      }.`,
    );
  }

  if (toolName.startsWith('mcp__')) {
    const displayName = typeof record.displayName === 'string' ? record.displayName : 'MCP';
    const snippets = Array.isArray(record.snippets) ? record.snippets : [];
    const firstSnippet =
      snippets.length > 0 && typeof snippets[0] === 'string' ? snippets[0] : null;
    if (firstSnippet) {
      return truncateFact(`${displayName}: ${firstSnippet}`);
    }
    if (record.ok === true) {
      return truncateFact(`${displayName}: returned ${snippets.length} result(s).`);
    }
    return null;
  }

  return null;
}

export function createInitialWorkingState(params: {
  goal: string;
  selectedPack: ToolPackId;
  features: ExecutiveTurnFeatures;
  pendingCalendarChangeId?: string;
}): ExecutiveWorkingState {
  return {
    goal: params.goal,
    selectedPack: params.selectedPack,
    phase: initialPhaseForPack(params.selectedPack, params.features),
    primaryDomain: mapPackToPrimaryDomain(params.selectedPack),
    completedSteps: [],
    nextStep: initialNextStep(params.selectedPack, params.features),
    factsLearned: [],
    artifacts: {
      pendingCalendarChangeId: params.pendingCalendarChangeId,
      draftCandidatePresent: params.features.draftCandidatePresent,
    },
  };
}

export function createWorkingStateController(initialState: ExecutiveWorkingState) {
  let state = initialState;

  const setPhase = (
    nextPhase: ExecutiveWorkingStatePhase,
    nextStep: string | null,
  ) => {
    if (state.phase !== nextPhase) {
      logger.info('[executiveAgent] working_state.phase', {
        from: state.phase,
        to: nextPhase,
        selectedPack: state.selectedPack,
      });
    }

    state = {
      ...state,
      phase: nextPhase,
      nextStep,
    };
  };

  return {
    getState(): ExecutiveWorkingState {
      return state;
    },

    updateFromToolResult(toolName: string, result: unknown) {
      const toolSummary = summarizeToolResult(toolName, result);
      const learnedFact = deriveFact(toolName, result);
      const userFacingText = extractUserFacingToolText(toolName, result);

      state = {
        ...state,
        completedSteps: uniquePush(state.completedSteps, toolName),
        factsLearned: uniquePush(state.factsLearned, learnedFact),
        artifacts: {
          ...state.artifacts,
          lastTool: toolName,
          lastToolSummary: toolSummary ?? undefined,
          lastUserFacingText: userFacingText ?? state.artifacts.lastUserFacingText,
        },
      };

      const record = result && typeof result === 'object'
        ? (result as Record<string, unknown>)
        : null;

      if (toolName === 'plan_calendar_change') {
        const pendingChange = record?.pendingChange;
        const plan =
          record?.plan && typeof record.plan === 'object'
            ? (record.plan as Record<string, unknown>)
            : null;
        if (pendingChange && typeof pendingChange === 'object') {
          const pendingId = (pendingChange as Record<string, unknown>).pendingId;
          state = {
            ...state,
            artifacts: {
              ...state.artifacts,
              pendingCalendarChangeId:
                typeof pendingId === 'string' ? pendingId : state.artifacts.pendingCalendarChangeId,
            },
          };
          setPhase('await_approval', 'Wait for confirm, cancel, or explicit modification.');
          return;
        }

        if (record?.ok === false) {
          setPhase('clarify', 'Ask one short clarification and stop.');
          return;
        }

        if (plan?.action === 'clarify') {
          setPhase('clarify', 'Ask one short clarification and stop.');
          return;
        }

        setPhase('draft', 'Prepare a concise calendar preview.');
        return;
      }

      if (toolName === 'plan_mcp_action') {
        const pendingAction = record?.pendingAction;
        if (pendingAction && typeof pendingAction === 'object') {
          const pendingId = (pendingAction as Record<string, unknown>).pendingId;
          state = {
            ...state,
            artifacts: {
              ...state.artifacts,
              pendingMcpActionId:
                typeof pendingId === 'string' ? pendingId : state.artifacts.pendingMcpActionId,
            },
          };
          setPhase('await_approval', 'Wait for confirm, cancel, or explicit replacement.');
          return;
        }

        if (record?.ok === false) {
          setPhase('clarify', 'Ask one short clarification and stop.');
          return;
        }

        setPhase('draft', 'Prepare a concise external action preview.');
        return;
      }

      if (toolName === 'commit_calendar_change') {
        if (record?.ok === true) {
          setPhase('complete', null);
        } else {
          setPhase('failed', 'Explain the calendar failure briefly.');
        }
        return;
      }

      if (toolName === 'commit_mcp_action' || toolName === 'cancel_mcp_action') {
        if (record?.ok === true) {
          setPhase('complete', null);
        } else {
          setPhase('failed', 'Explain the external action failure briefly.');
        }
        return;
      }

      if (toolName === 'send_email') {
        if (record?.success === true) {
          setPhase('complete', null);
        } else {
          setPhase('failed', 'Explain that the email was not sent.');
        }
        return;
      }

      if (
        [
          'add_email_alert',
          'update_email_alert',
          'remove_email_alert',
          'add_reminder',
          'snooze_reminder',
          'dismiss_reminder',
          'cancel_reminder',
        ].includes(toolName)
      ) {
        if (record?.success === true) {
          setPhase('complete', null);
        } else {
          setPhase('failed', 'Explain the action failure briefly.');
        }
        return;
      }

      if (record?.error === 'tool_budget_exceeded') {
        setPhase('clarify', 'Ask one short clarifying question.');
      }
    },

    updateFromResponse(response: string) {
      if (state.phase === 'complete' || state.phase === 'failed' || state.phase === 'await_approval') {
        return;
      }

      if (detectDraftMarkers(response)) {
        state = {
          ...state,
          artifacts: {
            ...state.artifacts,
            draftCandidatePresent: true,
          },
        };
        setPhase('await_approval', 'Wait for explicit send approval.');
        return;
      }

      if (response.trim().endsWith('?')) {
        setPhase('clarify', 'Wait for the user to answer the clarification.');
        return;
      }

      setPhase('complete', null);
    },

    markFailed(nextStep: string | null = 'Explain the failure briefly.') {
      setPhase('failed', nextStep);
    },
  };
}
