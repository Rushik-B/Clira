# Button Components

Reusable button primitives that power the queue and folder experiences.

## Components

### `PrimaryButton`
Use for irreversible or high-signal actions such as "Approve", "Save", or "Send".
- Emerald chroma with contrast-aware text
- Keyboard shortcut badge support via the `keyboardShortcut` prop
- Mobile-friendly defaults (`w-full` on small screens)

```tsx
import { PrimaryButton } from '@/components/ui/buttons';

<PrimaryButton onClick={handleApprove} keyboardShortcut="⌘↵">
  Approve & Send
</PrimaryButton>
```

### `LiquidButton`
Use for secondary controls, dismiss/cancel actions, or contextual utilities.
- Glassy appearance with `variant="cool"` for neon lighting
- `responsive` prop opt-in for the familiar `w-full sm:w-auto` behaviour
- `minWidth` presets (`sm` → `xl`) mirror the legacy outline control
- Exposes the `LIQUID_BUTTON_BASE_CLASS` helper for consistent typography and padding

```tsx
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';

<LiquidButton
  onClick={handleRefresh}
  variant="cool"
  responsive
  className={LIQUID_BUTTON_BASE_CLASS}
>
  Refresh Queue
</LiquidButton>
```

## Shared Props

| Prop | Type | Notes |
| --- | --- | --- |
| `onClick` | `MouseEventHandler<HTMLButtonElement> \| () => void` | Handles async or sync actions |
| `disabled` | `boolean` | Applies consistent opacity + pointer rules |
| `className` | `string` | Tailwind overrides appended after base styles |
| `aria-label` | `string` | Required for icon-only usage |
| `type` | `'button' \| 'submit' \| 'reset'` | Defaults to `'button'` |
| `minWidth` | `'none' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | Adds preset min-width utility |

### LiquidButton Extras

| Prop | Type | Notes |
| --- | --- | --- |
| `variant` | `'default' \| 'cool' \| 'destructive' \| 'outline' \| 'secondary' \| 'ghost' \| 'link'` | Visual theme; `cool` keeps parity with queue refresh controls |
| `size` | `'icon' \| 'sm' \| 'default' \| 'lg' \| 'xl' \| 'xxl'` | Tailored padding + height |
| `responsive` | `boolean` | Adds `w-full sm:w-auto` automatically |

## Import

```tsx
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
```
