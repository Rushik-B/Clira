# Dev Sandbox System

This directory contains development-only tools for staging and testing the Clira UI without requiring backend integration or real email data.

## ⚠️ Important Maintenance Note

**Whenever changes are made to components in this directory, update this README.md file accordingly.** This ensures the documentation stays current with the implementation.

## Overview

The dev sandbox system provides two main modes for UI development and demo staging:

1. **Single Card Harness** - Shows one email card in "generating reply" state
2. **Full Queue Sandbox** - Complete queue interface with mock data and full UI flows

## Environment Variables

Add these to your `.env.local` file to enable different sandbox modes:

```bash
# Single card harness (shows one card in "generating" state)
NEXT_PUBLIC_DEV_FORCE_QUEUE_CARD_STATE=generating

# Full queue sandbox (complete queue UI with mock data)
NEXT_PUBLIC_DEV_QUEUE_SANDBOX=full
```

**Note:** These flags only work in non-production builds and are automatically disabled in production.

## Files Structure

### Core Files

- **`uiOverrides.ts`** - Environment flag detection and utilities
- **`useSandboxQueueActions.ts`** - Mock queue actions hook (no network calls)
- **`EmailQueueCardDevHarness.tsx`** - Single card harness component
- **`FullQueueSandbox.tsx`** - Complete queue sandbox component

### Integration

- **`QueuePage.tsx`** - Modified to conditionally render sandbox components based on env flags

## Single Card Harness

**Purpose:** UI development for individual email cards, especially the "generating reply" state.

**Features:**
- Shows one email card in generating state
- Real UI flows: modals, toasts, animations
- Uses `useSandboxQueueActions` for simulated actions
- No network calls required

**Usage:**
```bash
# In .env.local
NEXT_PUBLIC_DEV_FORCE_QUEUE_CARD_STATE=generating
```

## Full Queue Sandbox

**Purpose:** Complete queue interface for demos, testing, and staging.

**Features:**
- Full queue list with mock data from `mockQueueData.ts`
- All UI components: checkboxes, bulk actions, modals, toasts
- Simulated approve/reject/edit/dismiss flows with animations
- Refresh button to reload mock data
- No backend dependencies

**Usage:**
```bash
# In .env.local
NEXT_PUBLIC_DEV_QUEUE_SANDBOX=full
```

## Mock Data

The sandbox uses `src/data/mockQueueData.ts` which contains:
- 12 diverse email scenarios
- Realistic content and metadata
- Various confidence levels and statuses
- Proper label configurations

## UI Synchronization

### How UI Changes Propagate

**✅ Automatic Synchronization:**
- The sandbox components use the **same UI components** as the real queue
- Changes to `EmailQueueCard`, `RejectDialog`, `EmailViewer`, `Toast`, etc. automatically appear in the sandbox
- Layout, styling, animations, and interactions stay in sync

**⚠️ Manual Updates Required:**
- Changes to `QueuePage.tsx` structure may need to be mirrored in `FullQueueSandbox.tsx`
- New queue actions or state management changes may require updates to `useSandboxQueueActions.ts`
- New environment flags need to be added to `uiOverrides.ts`

### When to Update Sandbox Files

1. **QueuePage.tsx changes:**
   - New UI sections (headers, stats, bulk actions)
   - Layout modifications
   - New modal integrations

2. **Queue actions changes:**
   - New action types
   - Modified action signatures
   - New state management patterns

3. **Environment configuration:**
   - New dev flags
   - Modified flag behavior

## Development Workflow

### For UI Development
1. Enable single card harness: `NEXT_PUBLIC_DEV_FORCE_QUEUE_CARD_STATE=generating`
2. Navigate to queue page
3. Make changes to `EmailQueueCard` or related components
4. Changes appear immediately in the harness

### For Demo Staging
1. Enable full sandbox: `NEXT_PUBLIC_DEV_QUEUE_SANDBOX=full`
2. Navigate to queue page
3. Use the complete interface with mock data
4. All interactions work: approve, reject, edit, bulk actions

### For Testing
1. Use mock data scenarios from `mockQueueData.ts`
2. Test different confidence levels and statuses
3. Verify animations and state transitions
4. Test modal interactions and toast notifications

## Best Practices

1. **Keep sandbox components minimal** - They should primarily compose existing UI components
2. **Use the same hooks and state management** as the real queue when possible
3. **Document any manual synchronization requirements** in this README
4. **Test both sandbox modes** when making queue-related changes
5. **Update this documentation** when adding new dev tools or modifying existing ones

## Troubleshooting

### Sandbox Not Loading
- Check environment variables in `.env.local`
- Ensure you're in development mode (not production)
- Restart the development server after changing env vars

### UI Out of Sync
- Verify you're using the same components in sandbox and real queue
- Check if `QueuePage.tsx` changes need to be mirrored in `FullQueueSandbox.tsx`
- Ensure `useSandboxQueueActions.ts` matches the real queue actions interface

### Mock Data Issues
- Check `mockQueueData.ts` for proper data structure
- Verify `QueueItem` interface matches mock data
- Ensure all required fields are present in mock items

## Future Enhancements

Potential additions to the dev sandbox system:
- Email simulator integration
- Custom mock data scenarios
- Performance testing tools
- Accessibility testing helpers
- Visual regression testing support

---

**Last Updated:** [Current Date]  
**Maintainer:** Development Team  
**Next Review:** When significant changes are made to queue UI or dev tools
