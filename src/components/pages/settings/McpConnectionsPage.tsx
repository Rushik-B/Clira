'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plug2,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useMcpConnections } from '@/hooks/useMcpConnections';
import {
  buildConnectionSnapshotVersion,
  parseEnvironmentVariables,
  parseTransportHeaders,
  type AuthMode,
  type ConnectionStatus,
  type McpConnectionSummary,
  type McpHeaderEntry,
  type McpToolSummary,
  type TransportType,
} from '@/lib/services/mcp/ui';
import { Button } from '@/components/ui/sidebar/button';
import { Input } from '@/components/ui/sidebar/input';
import { SettingsShell } from './SettingsShell';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { dot: string; label: string; text: string; ring: string }
> = {
  synced: {
    dot: 'bg-emerald-400',
    label: 'Synced',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/20',
  },
  pending: {
    dot: 'bg-amber-400 animate-pulse',
    label: 'Pending',
    text: 'text-amber-400',
    ring: 'ring-amber-500/20',
  },
  degraded: {
    dot: 'bg-red-400',
    label: 'Degraded',
    text: 'text-red-400',
    ring: 'ring-red-500/20',
  },
  disabled: {
    dot: 'bg-gray-500',
    label: 'Disabled',
    text: 'text-gray-500',
    ring: 'ring-gray-500/20',
  },
};

const ACTION_STYLES: Record<string, string> = {
  read: 'bg-sky-500/10 text-sky-400 ring-sky-500/15',
  write: 'bg-amber-500/10 text-amber-400 ring-amber-500/15',
  delete: 'bg-red-500/10 text-red-400 ring-red-500/15',
  side_effectful: 'bg-purple-500/10 text-purple-400 ring-purple-500/15',
};

// ---------------------------------------------------------------------------
// Shared UI pieces
// ---------------------------------------------------------------------------

function GradientSectionCard({
  title,
  subtitle,
  icon,
  accentFrom = 'from-violet-500/25',
  accentVia = 'via-violet-400/8',
  accentTo = 'to-transparent',
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  accentFrom?: string;
  accentVia?: string;
  accentTo?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative"
    >
      <div
        className={cn(
          'rounded-2xl p-px bg-gradient-to-b',
          accentFrom,
          accentVia,
          accentTo,
        )}
      >
        <div className="rounded-[15px] bg-gray-950/90 backdrop-blur-sm">
          <header className="flex items-center gap-4 px-6 pt-6 pb-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/[0.07] to-white/[0.02] ring-1 ring-white/[0.06]">
              {icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-white">
                {title}
              </h3>
              {subtitle && (
                <p className="mt-0.5 text-[13px] leading-relaxed text-gray-400">
                  {subtitle}
                </p>
              )}
            </div>
          </header>
          <div className="px-6 pb-6">{children}</div>
        </div>
      </div>
    </motion.section>
  );
}

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <span className="mb-2 flex items-baseline gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        {children}
      </span>
      {hint && (
        <span className="text-[10px] text-gray-600 normal-case tracking-normal">
          {hint}
        </span>
      )}
    </span>
  );
}

function StyledInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        'h-10 rounded-xl bg-black dark:bg-black border-white/[0.08] shadow-none text-[13px] text-white',
        'placeholder:text-gray-500 transition-all duration-200',
        'focus:border-white/20 focus:ring-2 focus:ring-white/[0.06]',
        'hover:border-white/15',
        className,
      )}
      {...props}
    />
  );
}

function StyledTextarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-xl border border-white/[0.08] bg-black px-3.5 py-3 shadow-none text-[13px] text-white',
        'placeholder:text-gray-500 transition-all duration-200 outline-none resize-none',
        'focus:border-white/20 focus:ring-2 focus:ring-white/[0.06]',
        'hover:border-white/15',
        'leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/[0.06]">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'relative rounded-lg px-4 py-1.5 text-[12px] font-medium transition-all duration-200 cursor-pointer',
            value === opt.value
              ? 'bg-white/[0.08] text-white ring-1 ring-white/[0.1] shadow-sm'
              : 'text-gray-500 hover:text-gray-300',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  title,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex size-8 items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-40 cursor-pointer',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const s = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
        s.text,
        s.ring,
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton / Empty / Error
// ---------------------------------------------------------------------------

function ConnectionSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-800/40 bg-gray-950/50 p-4">
      <div className="flex items-center gap-4">
        <div className="size-10 rounded-xl bg-gray-800/40" />
        <div className="flex flex-col gap-2 flex-1">
          <div className="h-4 w-40 rounded-lg bg-gray-800/40" />
          <div className="h-3 w-28 rounded-lg bg-gray-800/25" />
        </div>
        <div className="size-8 rounded-lg bg-gray-800/25" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-14 px-6 text-center">
      <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-500/5 ring-1 ring-violet-500/15">
        <Plug2 className="size-7 text-violet-400/60" />
      </div>
      <h3 className="text-[15px] font-semibold text-white mb-1.5">
        No servers connected
      </h3>
      <p className="text-[13px] text-gray-500 max-w-sm mx-auto leading-relaxed">
        Connect an MCP server to extend Clira with external tools — Notion,
        Linear, or any MCP-compatible service.
      </p>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="py-10 px-6 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-red-500/[0.06] ring-1 ring-red-500/20">
        <AlertCircle className="size-5 text-red-400" />
      </div>
      <p className="text-[13px] text-red-300 mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 text-[13px] text-gray-400 hover:text-white transition-colors cursor-pointer"
      >
        <RefreshCw className="size-3.5" />
        Try again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool row
// ---------------------------------------------------------------------------

function ToolRow({
  tool,
  onToggleDisabled,
  saving,
}: {
  tool: McpToolSummary;
  onToggleDisabled: (tool: McpToolSummary) => Promise<void>;
  saving: boolean;
}) {
  const style =
    ACTION_STYLES[tool.actionClass] ??
    'bg-gray-500/10 text-gray-400 ring-gray-500/15';

  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.015]">
      <Wrench className="mt-0.5 size-3.5 shrink-0 text-gray-600" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'truncate text-[13px] font-medium',
              tool.disabled ? 'text-gray-600 line-through' : 'text-gray-200',
            )}
          >
            {tool.displayTitle}
          </span>
          <span
            className={cn(
              'rounded-md px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset',
              style,
            )}
          >
            {tool.actionClass}
          </span>
          {tool.safeForAutoUse && (
            <span className="rounded-md bg-emerald-500/8 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-emerald-400 ring-1 ring-inset ring-emerald-500/15">
              auto
            </span>
          )}
        </div>
        {tool.description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600 line-clamp-1">
            {tool.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          void onToggleDisabled(tool);
        }}
        disabled={saving}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-all duration-200 disabled:opacity-40 cursor-pointer',
          tool.disabled
            ? 'text-gray-400 ring-gray-700/60 hover:text-emerald-300 hover:ring-emerald-500/25'
            : 'text-red-400 ring-red-500/15 bg-red-500/[0.04] hover:ring-red-500/30',
        )}
      >
        {saving ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Ban className="size-3" />
        )}
        {tool.disabled ? 'Enable' : 'Disable'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------

function ConnectionCard({
  conn,
  onSync,
  onDelete,
  syncing,
  index,
}: {
  conn: McpConnectionSummary;
  onSync: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
  syncing: boolean;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<McpToolSummary[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [savingToolName, setSavingToolName] = useState<string | null>(null);
  const [toolError, setToolError] = useState('');
  const disabledToolNames = useMemo(
    () => new Set(conn.disabledToolNames),
    [conn.disabledToolNames],
  );

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    setToolError('');
    try {
      const res = await fetch(`/api/mcp/connections/${conn.id}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success) {
        setTools(
          (data.tools ?? []).map((tool: McpToolSummary) => ({
            ...tool,
            disabled: tool.disabled || disabledToolNames.has(tool.toolName),
          })),
        );
      } else {
        setTools([]);
        setToolError('Failed to load tools.');
      }
    } catch {
      setTools([]);
      setToolError('Failed to load tool settings.');
    } finally {
      setLoadingTools(false);
    }
  }, [conn.id, disabledToolNames]);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => {
      const expanding = !prev;
      if (expanding) {
        void loadTools();
      }
      return expanding;
    });
  }, [loadTools]);

  const handleToggleDisabled = useCallback(
    async (tool: McpToolSummary) => {
      const currentTools = tools ?? [];
      const nextDisabledToolNames = currentTools
        .filter((c) =>
          c.toolName === tool.toolName ? !c.disabled : c.disabled,
        )
        .map((c) => c.toolName);

      setSavingToolName(tool.toolName);
      setToolError('');
      setTools(
        (current) =>
          current?.map((c) =>
            c.toolName === tool.toolName
              ? { ...c, disabled: !c.disabled }
              : c,
          ) ?? current,
      );

      try {
        const res = await fetch(`/api/mcp/connections/${conn.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabledToolNames: nextDisabledToolNames }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? 'Failed to update tool access.');
        }
      } catch (err) {
        setTools(
          (current) =>
            current?.map((c) =>
              c.toolName === tool.toolName
                ? { ...c, disabled: tool.disabled }
                : c,
            ) ?? current,
        );
        setToolError(
          err instanceof Error ? err.message : 'Failed to update tool access.',
        );
      } finally {
        setSavingToolName(null);
      }
    },
    [conn.id, tools],
  );

  const lastSynced = conn.lastSyncedAt
    ? new Date(conn.lastSyncedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Never';

  const statusAccent: Record<ConnectionStatus, string> = {
    synced: 'from-emerald-500/40 to-emerald-500/5',
    pending: 'from-amber-500/40 to-amber-500/5',
    degraded: 'from-red-500/40 to-red-500/5',
    disabled: 'from-gray-600/40 to-gray-600/5',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: 'easeOut' }}
      className="group/card relative overflow-hidden rounded-xl border border-gray-800/40 bg-gray-950/60 transition-all duration-300 hover:border-gray-700/50"
    >
      {/* Left accent bar */}
      <div
        className={cn(
          'absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b',
          statusAccent[conn.status],
        )}
      />

      {/* Main row */}
      <div className="flex items-center gap-3 p-4 pl-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] ring-1 ring-white/[0.05]">
          <Plug2 className="size-4.5 text-gray-400" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-white">
              {conn.displayName}
            </span>
            <StatusBadge status={conn.status} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
            <span className="font-mono">{conn.serverKey}</span>
            <span className="text-gray-700">·</span>
            <span>
              {conn.toolCount} tool{conn.toolCount !== 1 ? 's' : ''}
            </span>
            <span className="text-gray-700">·</span>
            <span>synced {lastSynced}</span>
          </div>
          {conn.degradedReason && (
            <p className="mt-1 text-[11px] text-red-400/70">
              {conn.degradedReason}
            </p>
          )}
        </div>

        <div className="hidden max-w-xs shrink-0 sm:block">
          <p className="text-[11px] leading-relaxed text-gray-500 line-clamp-2">
            {conn.packDescription ??
              'Pack description will appear after the next sync.'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            onClick={() => {
              void onSync(conn.id);
            }}
            disabled={syncing}
            title="Sync manifest"
            className="text-gray-500 hover:text-white hover:bg-white/[0.05]"
          >
            <RefreshCw
              className={cn('size-3.5', syncing && 'animate-spin')}
            />
          </IconButton>
          <IconButton
            onClick={() => onDelete(conn.id)}
            title="Remove connection"
            className="text-gray-500 hover:text-red-400 hover:bg-red-500/[0.06]"
          >
            <Trash2 className="size-3.5" />
          </IconButton>
          <IconButton
            onClick={toggleExpand}
            title={expanded ? 'Collapse' : 'Show tools'}
            className="text-gray-500 hover:text-white hover:bg-white/[0.05]"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </IconButton>
        </div>
      </div>

      {/* Expanded tools */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-800/30 bg-gray-950/30 px-4 py-3 pl-5">
              {toolError && (
                <p className="mb-2 text-[11px] text-red-400/80">{toolError}</p>
              )}
              {loadingTools ? (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="size-3.5 animate-spin text-gray-600" />
                  <span className="text-[12px] text-gray-500">
                    Loading tools…
                  </span>
                </div>
              ) : tools && tools.length > 0 ? (
                <div className="flex flex-col gap-px">
                  {tools.map((tool) => (
                    <ToolRow
                      key={tool.id}
                      tool={tool}
                      onToggleDisabled={handleToggleDisabled}
                      saving={savingToolName === tool.toolName}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-[12px] text-gray-600">
                  {conn.status === 'pending'
                    ? 'Sync in progress — tools will appear after completion.'
                    : 'No tools discovered. Try syncing the connection.'}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Add connection form
// ---------------------------------------------------------------------------

interface AddFormState {
  displayName: string;
  serverKey: string;
  transportType: TransportType;
  command: string;
  args: string;
  endpoint: string;
  transportHeaders: McpHeaderEntry[];
  authMode: AuthMode;
  bearerToken: string;
  headerName: string;
  headerValue: string;
  envVars: string;
}

let transportHeaderId = 0;

function createTransportHeader(name = '', value = ''): McpHeaderEntry {
  transportHeaderId += 1;
  return {
    id: `transport-header-${transportHeaderId}`,
    name,
    value,
  };
}

function createInitialFormState(): AddFormState {
  return {
    displayName: '',
    serverKey: '',
    transportType: 'stdio',
    command: '',
    args: '',
    endpoint: '',
    transportHeaders: [createTransportHeader()],
    authMode: 'none',
    bearerToken: '',
    headerName: '',
    headerValue: '',
    envVars: '',
  };
}

function AddConnectionForm({
  onCreated,
}: {
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState<AddFormState>(() =>
    createInitialFormState(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const set = useCallback(
    <K extends keyof AddFormState>(key: K, value: AddFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const updateTransportHeader = useCallback(
    (
      headerId: string,
      next: Partial<Pick<McpHeaderEntry, 'name' | 'value'>>,
    ) => {
      setForm((prev) => ({
        ...prev,
        transportHeaders: prev.transportHeaders.map((h) =>
          h.id === headerId ? { ...h, ...next } : h,
        ),
      }));
    },
    [],
  );

  const addTransportHeader = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      transportHeaders: [...prev.transportHeaders, createTransportHeader()],
    }));
  }, []);

  const removeTransportHeader = useCallback((headerId: string) => {
    setForm((prev) => {
      const remaining = prev.transportHeaders.filter(
        (h) => h.id !== headerId,
      );
      return {
        ...prev,
        transportHeaders:
          remaining.length > 0 ? remaining : [createTransportHeader()],
      };
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setSuccess('');

      if (!form.displayName.trim()) {
        setError('Display name is required.');
        return;
      }
      if (form.transportType === 'stdio' && !form.command.trim()) {
        setError('Command is required for stdio transport.');
        return;
      }
      if (form.transportType === 'streamable_http' && !form.endpoint.trim()) {
        setError('Endpoint URL is required for HTTP transport.');
        return;
      }
      if (form.authMode === 'bearer_token' && !form.bearerToken.trim()) {
        setError('Bearer token is required.');
        return;
      }
      if (form.authMode === 'static_header') {
        if (!form.headerName.trim()) {
          setError('Secret header name is required.');
          return;
        }
        if (!form.headerValue.trim()) {
          setError('Secret header value is required.');
          return;
        }
      }

      const { env, error: envError } = parseEnvironmentVariables(
        form.envVars,
      );
      if (envError) {
        setError(envError);
        return;
      }

      const { headers, error: headersError } = parseTransportHeaders(
        form.transportHeaders,
      );
      if (headersError) {
        setError(headersError);
        return;
      }

      const transport =
        form.transportType === 'stdio'
          ? {
              type: 'stdio' as const,
              command: form.command.trim(),
              args: form.args
                .split(/\s+/)
                .map((a) => a.trim())
                .filter(Boolean),
            }
          : {
              type: 'streamable_http' as const,
              endpoint: form.endpoint.trim(),
              headers,
            };

      let secrets: Record<string, unknown>;
      if (form.authMode === 'bearer_token') {
        secrets = {
          authMode: 'bearer_token',
          bearerToken: form.bearerToken.trim(),
          env,
        };
      } else if (form.authMode === 'static_header') {
        secrets = {
          authMode: 'static_header',
          headerName: form.headerName.trim(),
          headerValue: form.headerValue.trim(),
          env,
        };
      } else {
        secrets = { authMode: 'none', env };
      }

      const payload = {
        displayName: form.displayName.trim(),
        serverKey: form.serverKey.trim() || undefined,
        transport,
        secrets,
      };

      setSaving(true);
      try {
        const res = await fetch('/api/mcp/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Failed to create connection.');
          return;
        }
        setSuccess(`${form.displayName} connected — sync started.`);
        setForm(createInitialFormState());
        await onCreated();
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setSaving(false);
      }
    },
    [form, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Name + key */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Display Name</FieldLabel>
          <StyledInput
            value={form.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder="e.g. Notion"
          />
        </label>
        <label className="block">
          <FieldLabel hint="optional">Server Key</FieldLabel>
          <StyledInput
            value={form.serverKey}
            onChange={(e) => set('serverKey', e.target.value)}
            placeholder="e.g. notion"
          />
          <p className="mt-1.5 text-[10px] text-gray-600">
            Alphanumeric, hyphens, underscores. Auto-generated if empty.
          </p>
        </label>
      </div>

      {/* Transport type */}
      <div>
        <FieldLabel>Transport</FieldLabel>
        <SegmentedControl
          options={[
            { value: 'stdio' as TransportType, label: 'stdio (local)' },
            {
              value: 'streamable_http' as TransportType,
              label: 'HTTP (remote)',
            },
          ]}
          value={form.transportType}
          onChange={(v) => set('transportType', v)}
        />
      </div>

      {/* Transport config */}
      {form.transportType === 'stdio' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <FieldLabel>Command</FieldLabel>
            <StyledInput
              value={form.command}
              onChange={(e) => set('command', e.target.value)}
              placeholder="e.g. npx"
            />
          </label>
          <label className="block">
            <FieldLabel>Arguments</FieldLabel>
            <StyledInput
              value={form.args}
              onChange={(e) => set('args', e.target.value)}
              placeholder="e.g. -y @notionhq/notion-mcp-server"
            />
            <p className="mt-1.5 text-[10px] text-gray-600">
              Space-separated.
            </p>
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="block">
            <FieldLabel>Endpoint URL</FieldLabel>
            <StyledInput
              value={form.endpoint}
              onChange={(e) => set('endpoint', e.target.value)}
              placeholder="https://your-server.com/mcp"
            />
          </label>

          {/* Transport Headers */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                  Transport Headers
                </span>
                <p className="mt-1 text-[10px] text-gray-600">
                  Non-secret HTTP headers. Use auth below for sensitive values.
                </p>
              </div>
              <button
                type="button"
                onClick={addTransportHeader}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] font-medium text-gray-400 transition-colors hover:border-white/15 hover:text-white hover:bg-white/[0.05] cursor-pointer"
              >
                <Plus className="size-3" />
                Add
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              {form.transportHeaders.map((header, idx) => (
                <div
                  key={header.id}
                  className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <StyledInput
                    value={header.name}
                    onChange={(e) =>
                      updateTransportHeader(header.id, {
                        name: e.target.value,
                      })
                    }
                    placeholder={idx === 0 ? 'X-Workspace' : 'Header name'}
                  />
                  <StyledInput
                    value={header.value}
                    onChange={(e) =>
                      updateTransportHeader(header.id, {
                        value: e.target.value,
                      })
                    }
                    placeholder={idx === 0 ? 'production' : 'Header value'}
                  />
                  <button
                    type="button"
                    onClick={() => removeTransportHeader(header.id)}
                    className="flex h-10 items-center justify-center rounded-xl border border-white/[0.08] px-3 text-gray-500 transition-all hover:border-red-500/20 hover:text-red-400 hover:bg-red-500/[0.04] cursor-pointer"
                    title="Remove header"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Auth mode */}
      <div>
        <FieldLabel>Authentication</FieldLabel>
        <SegmentedControl
          options={[
            { value: 'none' as AuthMode, label: 'None' },
            { value: 'bearer_token' as AuthMode, label: 'Bearer Token' },
            { value: 'static_header' as AuthMode, label: 'Secret Header' },
          ]}
          value={form.authMode}
          onChange={(v) => set('authMode', v)}
        />
      </div>

      {/* Auth fields */}
      {form.authMode === 'bearer_token' && (
        <label className="block">
          <FieldLabel>Token</FieldLabel>
          <StyledInput
            type="password"
            value={form.bearerToken}
            onChange={(e) => set('bearerToken', e.target.value)}
            placeholder="sk-..."
          />
        </label>
      )}

      {form.authMode === 'static_header' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <FieldLabel>Header Name</FieldLabel>
              <StyledInput
                value={form.headerName}
                onChange={(e) => set('headerName', e.target.value)}
                placeholder="X-API-Key"
              />
            </label>
            <label className="block">
              <FieldLabel>Header Value</FieldLabel>
              <StyledInput
                type="password"
                value={form.headerValue}
                onChange={(e) => set('headerValue', e.target.value)}
                placeholder="your-api-key"
              />
            </label>
          </div>
          <p className="text-[10px] text-gray-600">
            Use for a single sensitive header. For multiple non-secret
            transport headers, use the list above.
          </p>
        </div>
      )}

      {/* Env vars */}
      {form.transportType === 'stdio' && (
        <label className="block">
          <FieldLabel hint="optional">Environment Variables</FieldLabel>
          <StyledTextarea
            value={form.envVars}
            onChange={(e) => set('envVars', e.target.value)}
            placeholder={'NOTION_API_KEY=ntn_...\nANOTHER_VAR=value'}
            rows={3}
          />
          <p className="mt-1.5 text-[10px] text-gray-600">
            One KEY=VALUE per line. Passed to the spawned process.
          </p>
        </label>
      )}

      {/* Messages */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/15 bg-red-500/[0.04] px-4 py-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
              <p className="text-[13px] text-red-300">{error}</p>
            </div>
          </motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] px-4 py-3">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              <p className="text-[13px] text-emerald-300">{success}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Submit */}
      <div className="flex justify-end pt-1">
        <Button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-white px-6 text-[13px] font-semibold text-gray-950 shadow-lg shadow-white/[0.06] transition-all duration-200 hover:bg-gray-100 disabled:opacity-50 cursor-pointer"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {saving ? 'Connecting…' : 'Connect Server'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

function DeleteConfirmation({
  name,
  onConfirm,
  onCancel,
  deleting,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-red-500/10 bg-red-500/[0.03] px-5 py-3"
    >
      <p className="text-[13px] text-gray-300">
        Remove <span className="font-semibold text-white">{name}</span> and
        all its synced tools?
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          disabled={deleting}
          className="rounded-lg border border-white/[0.08] px-3.5 py-1.5 text-[12px] font-medium text-gray-400 transition-colors hover:text-white hover:border-white/15 hover:bg-white/[0.05] cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={deleting}
          className="rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-1.5 text-[12px] font-medium text-red-300 transition-all hover:bg-red-500/20 disabled:opacity-40 cursor-pointer"
        >
          {deleting ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              Removing…
            </span>
          ) : (
            'Remove'
          )}
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export const McpConnectionsPage: React.FC = () => {
  const {
    connections,
    error,
    loading,
    manualRefreshing,
    syncingIds,
    refreshConnections,
    requestSync,
  } = useMcpConnections();
  const [deleteTarget, setDeleteTarget] = useState<McpConnectionSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/mcp/connections/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setDeleteTarget(null);
        await refreshConnections();
      }
    } catch {
      // user can retry
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, refreshConnections]);

  const handleSync = useCallback(
    async (connectionId: string) => {
      await requestSync(connectionId);
    },
    [requestSync],
  );

  const refreshButton = (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void refreshConnections({ manual: true });
      }}
      disabled={loading || manualRefreshing}
      className="rounded-xl border-white/[0.08] bg-transparent px-4 text-[13px] font-medium text-gray-300 transition-all hover:bg-white/[0.05] hover:text-white hover:border-white/15 disabled:opacity-40 cursor-pointer"
    >
      <RefreshCw
        className={cn('size-3.5', manualRefreshing && 'animate-spin')}
      />
      Refresh
    </Button>
  );

  return (
    <SettingsShell
      title="MCP Servers"
      subtitle="Connect external tools and services via Model Context Protocol"
      icon={Plug2}
      iconColor="text-violet-400"
      mobileActions={refreshButton}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-gray-500">
          Auto-refresh while syncs are in flight · revalidates on tab focus
        </p>
        {refreshButton}
      </div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteConfirmation
            name={deleteTarget.displayName}
            onConfirm={() => {
              void handleDelete();
            }}
            onCancel={() => setDeleteTarget(null)}
            deleting={deleting}
          />
        )}
      </AnimatePresence>

      {/* Connected Servers */}
      <GradientSectionCard
        title="Connected Servers"
        subtitle="MCP servers synced with your Clira agent"
        icon={<Plug2 className="size-5 text-violet-400" />}
      >
        {loading ? (
          <div className="flex flex-col gap-3">
            <ConnectionSkeleton />
            <ConnectionSkeleton />
          </div>
        ) : error ? (
          <ErrorBanner
            message={error}
            onRetry={() => {
              void refreshConnections({ manual: true });
            }}
          />
        ) : connections.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-3">
            {connections.map((conn, index) => (
              <ConnectionCard
                key={conn.id}
                conn={conn}
                onSync={handleSync}
                onDelete={(id) => {
                  const target = connections.find((c) => c.id === id);
                  if (target) setDeleteTarget(target);
                }}
                syncing={syncingIds.has(conn.id)}
                index={index}
              />
            ))}
          </div>
        )}
      </GradientSectionCard>

      {/* Add Server */}
      <GradientSectionCard
        title="Add Server"
        subtitle="Connect a new MCP-compatible server"
        icon={<Plus className="size-5 text-violet-400/70" />}
        accentFrom="from-indigo-500/20"
        accentVia="via-indigo-400/6"
        accentTo="to-transparent"
      >
        <AddConnectionForm onCreated={refreshConnections} />
      </GradientSectionCard>
    </SettingsShell>
  );
};
