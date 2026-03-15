'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
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
import { SettingsShell, SettingsSectionCard } from './SettingsShell';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<ConnectionStatus, { dot: string; label: string; text: string }> = {
  synced: { dot: 'bg-emerald-400', label: 'Synced', text: 'text-emerald-400' },
  pending: { dot: 'bg-amber-400', label: 'Pending', text: 'text-amber-400' },
  degraded: { dot: 'bg-red-400', label: 'Degraded', text: 'text-red-400' },
  disabled: { dot: 'bg-gray-500', label: 'Disabled', text: 'text-gray-500' },
};

const ACTION_CLASS_STYLES: Record<string, string> = {
  read: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
  write: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  delete: 'bg-red-500/15 text-red-300 border-red-500/20',
  side_effectful: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
};

const CAPABILITY_LABELS: Record<string, string> = {
  docs_read: 'Docs',
  storage_read: 'Storage',
  crm_lookup: 'CRM',
  project_tasks_read: 'Tasks',
  calendar_external_read: 'Calendar',
  calendar_external_mutation: 'Calendar Write',
  generic_read: 'Read',
  generic_mutation: 'Mutation',
};

// ---------------------------------------------------------------------------
// Skeleton / Empty / Error states
// ---------------------------------------------------------------------------

const ConnectionSkeleton: React.FC = () => (
  <div className="rounded-xl border border-gray-800/60 bg-gray-950/60 p-4 animate-pulse">
    <div className="flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-gray-800/60" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-44 rounded bg-gray-800/60" />
        <div className="h-3 w-28 rounded bg-gray-800/40" />
      </div>
      <div className="w-8 h-8 rounded-lg bg-gray-800/40" />
    </div>
  </div>
);

const EmptyState: React.FC = () => (
  <div className="text-center py-12 px-6">
    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gray-800/60 to-gray-900/60 border border-gray-700/40 flex items-center justify-center">
      <Plug2 className="w-8 h-8 text-gray-500" />
    </div>
    <h3 className="text-lg font-semibold text-white mb-2">No servers connected</h3>
    <p className="text-sm text-gray-400 max-w-sm mx-auto">
      Connect an MCP server to extend Clira with external tools like Notion, Linear, or any MCP-compatible service.
    </p>
  </div>
);

const ErrorBanner: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="text-center py-8 px-6">
    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-red-900/30 border border-red-800/40 flex items-center justify-center">
      <AlertCircle className="w-6 h-6 text-red-400" />
    </div>
    <p className="text-sm text-red-300 mb-4">{message}</p>
    <button
      onClick={onRetry}
      className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors cursor-pointer"
    >
      <RefreshCw className="w-4 h-4" />
      Try again
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const StatusBadge: React.FC<{ status: ConnectionStatus }> = ({ status }) => {
  const s = STATUS_STYLES[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span className={s.text}>{s.label}</span>
    </span>
  );
};

// ---------------------------------------------------------------------------
// Capability pill
// ---------------------------------------------------------------------------

const CapabilityPill: React.FC<{ cap: string }> = ({ cap }) => (
  <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 border border-white/8 text-gray-400 font-medium">
    {CAPABILITY_LABELS[cap] ?? cap}
  </span>
);

// ---------------------------------------------------------------------------
// Tool row (inside expanded connection)
// ---------------------------------------------------------------------------

const ToolRow: React.FC<{ tool: McpToolSummary }> = ({ tool }) => {
  const actionStyle = ACTION_CLASS_STYLES[tool.actionClass] ?? 'bg-gray-500/15 text-gray-300 border-gray-500/20';
  return (
    <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-white/[0.02] transition-colors">
      <Wrench className="w-3.5 h-3.5 text-gray-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-200 truncate">{tool.displayTitle}</span>
          <span className={`text-[10px] px-1.5 py-px rounded border font-medium ${actionStyle}`}>
            {tool.actionClass}
          </span>
          {tool.safeForAutoUse && (
            <span className="text-[10px] px-1.5 py-px rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-medium">
              auto
            </span>
          )}
        </div>
        {tool.description && (
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{tool.description}</p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------

const ConnectionCard: React.FC<{
  conn: McpConnectionSummary;
  onSync: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
  syncing: boolean;
}> = ({ conn, onSync, onDelete, syncing }) => {
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<McpToolSummary[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const snapshotVersion = buildConnectionSnapshotVersion(conn);

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const res = await fetch(`/api/mcp/connections/${conn.id}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success) {
        setTools(data.tools ?? []);
      }
    } catch {
      setTools([]);
    } finally {
      setLoadingTools(false);
    }
  }, [conn.id]);

  useEffect(() => {
    setTools(null);
  }, [snapshotVersion]);

  useEffect(() => {
    if (expanded && tools === null && !loadingTools) {
      void loadTools();
    }
  }, [expanded, loadingTools, loadTools, tools]);

  const toggleExpand = useCallback(() => {
    setExpanded((currentExpanded) => !currentExpanded);
  }, []);

  const lastSynced = conn.lastSyncedAt
    ? new Date(conn.lastSyncedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Never';

  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-950/60 overflow-hidden transition-all duration-200 hover:border-gray-700/60">
      {/* Main row */}
      <div className="flex items-center gap-3 p-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
          <Plug2 className="w-5 h-5 text-gray-400" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{conn.displayName}</span>
            <StatusBadge status={conn.status} />
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-gray-500 font-mono">{conn.serverKey}</span>
            <span className="text-gray-700 text-xs">·</span>
            <span className="text-xs text-gray-500">
              {conn.toolCount} tool{conn.toolCount !== 1 ? 's' : ''}
            </span>
            <span className="text-gray-700 text-xs">·</span>
            <span className="text-xs text-gray-500">synced {lastSynced}</span>
          </div>
          {conn.degradedReason && (
            <p className="text-xs text-red-400/80 mt-1">{conn.degradedReason}</p>
          )}
        </div>

        {/* Capabilities */}
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          {conn.capabilities.slice(0, 3).map((cap) => (
            <CapabilityPill key={cap} cap={cap} />
          ))}
          {conn.capabilities.length > 3 && (
            <span className="text-[11px] text-gray-500">+{conn.capabilities.length - 3}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              void onSync(conn.id);
            }}
            disabled={syncing}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-all disabled:opacity-40 cursor-pointer"
            title="Sync manifest"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => onDelete(conn.id)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
            title="Remove connection"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={toggleExpand}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
            title={expanded ? 'Collapse tools' : 'Show tools'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded tools panel */}
      {expanded && (
        <div className="border-t border-gray-800/40 bg-gray-950/40 px-4 py-3">
          {loadingTools ? (
            <div className="flex items-center gap-2 py-3 justify-center">
              <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
              <span className="text-xs text-gray-500">Loading tools...</span>
            </div>
          ) : tools && tools.length > 0 ? (
            <div className="space-y-0.5">
              {tools.map((tool) => (
                <ToolRow key={tool.id} tool={tool} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 text-center py-3">
              {conn.status === 'pending'
                ? 'Sync in progress — tools will appear after sync completes.'
                : 'No tools discovered. Try syncing the connection.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

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

const AddConnectionForm: React.FC<{
  onCreated: () => Promise<void>;
}> = ({ onCreated }) => {
  const [form, setForm] = useState<AddFormState>(() => createInitialFormState());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const set = useCallback(
    <K extends keyof AddFormState>(key: K, value: AddFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const updateTransportHeader = useCallback(
    (headerId: string, next: Partial<Pick<McpHeaderEntry, 'name' | 'value'>>) => {
      setForm((prev) => ({
        ...prev,
        transportHeaders: prev.transportHeaders.map((header) =>
          header.id === headerId ? { ...header, ...next } : header,
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
      const remainingHeaders = prev.transportHeaders.filter((header) => header.id !== headerId);
      return {
        ...prev,
        transportHeaders:
          remainingHeaders.length > 0 ? remainingHeaders : [createTransportHeader()],
      };
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setSuccess('');

      // Basic client-side validation
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

      const { env, error: envError } = parseEnvironmentVariables(form.envVars);
      if (envError) {
        setError(envError);
        return;
      }

      const { headers, error: headersError } = parseTransportHeaders(form.transportHeaders);
      if (headersError) {
        setError(headersError);
        return;
      }

      // Build payload
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
        secrets = { authMode: 'bearer_token', bearerToken: form.bearerToken.trim(), env };
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
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name + key */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Display Name</label>
          <Input
            value={form.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder="e.g. Notion"
            className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Server Key <span className="text-gray-600">(optional)</span>
          </label>
          <Input
            value={form.serverKey}
            onChange={(e) => set('serverKey', e.target.value)}
            placeholder="e.g. notion"
            className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
          />
          <p className="text-[11px] text-gray-600 mt-1">Alphanumeric, hyphens, underscores. Auto-generated if empty.</p>
        </div>
      </div>

      {/* Transport type toggle */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-2">Transport</label>
        <div className="flex gap-2">
          {(['stdio', 'streamable_http'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set('transportType', t)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                form.transportType === t
                  ? 'bg-white/10 border-white/15 text-white'
                  : 'bg-transparent border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300'
              }`}
            >
              {t === 'stdio' ? 'stdio (local)' : 'HTTP (remote)'}
            </button>
          ))}
        </div>
      </div>

      {/* Transport config */}
      {form.transportType === 'stdio' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Command</label>
            <Input
              value={form.command}
              onChange={(e) => set('command', e.target.value)}
              placeholder="e.g. npx"
              className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Arguments</label>
            <Input
              value={form.args}
              onChange={(e) => set('args', e.target.value)}
              placeholder="e.g. -y @notionhq/notion-mcp-server"
              className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
            />
            <p className="text-[11px] text-gray-600 mt-1">Space-separated.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Endpoint URL</label>
            <Input
              value={form.endpoint}
              onChange={(e) => set('endpoint', e.target.value)}
              placeholder="https://your-server.com/mcp"
              className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
            />
          </div>

          <div className="rounded-xl border border-gray-800/70 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400">Transport Headers</label>
                <p className="text-[11px] text-gray-600 mt-1">
                  Send multiple non-secret HTTP headers with the transport. Use secret auth below for
                  sensitive values.
                </p>
              </div>
              <button
                type="button"
                onClick={addTransportHeader}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Header
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {form.transportHeaders.map((header, index) => (
                <div key={header.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Input
                    value={header.name}
                    onChange={(e) => updateTransportHeader(header.id, { name: e.target.value })}
                    placeholder={index === 0 ? 'X-Workspace' : 'Header name'}
                    className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
                  />
                  <Input
                    value={header.value}
                    onChange={(e) => updateTransportHeader(header.id, { value: e.target.value })}
                    placeholder={index === 0 ? 'production' : 'Header value'}
                    className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeTransportHeader(header.id)}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-800 px-3 text-xs font-medium text-gray-400 transition-colors hover:border-red-500/40 hover:text-red-300"
                    title="Remove header"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Auth mode */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-2">Authentication</label>
        <div className="flex gap-2 flex-wrap">
          {([
            ['none', 'None'],
            ['bearer_token', 'Bearer Token'],
            ['static_header', 'Secret Header'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => set('authMode', mode)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                form.authMode === mode
                  ? 'bg-white/10 border-white/15 text-white'
                  : 'bg-transparent border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Auth fields */}
      {form.authMode === 'bearer_token' && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Token</label>
          <Input
            type="password"
            value={form.bearerToken}
            onChange={(e) => set('bearerToken', e.target.value)}
            placeholder="sk-..."
            className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
          />
        </div>
      )}

      {form.authMode === 'static_header' && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Header Name</label>
              <Input
                value={form.headerName}
                onChange={(e) => set('headerName', e.target.value)}
                placeholder="X-API-Key"
                className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Header Value</label>
              <Input
                type="password"
                value={form.headerValue}
                onChange={(e) => set('headerValue', e.target.value)}
                placeholder="your-api-key"
                className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-600">
            Use this for a single sensitive header value. For multiple non-secret transport headers, use
            the HTTP transport header list above.
          </p>
        </div>
      )}

      {/* Env vars (applicable to stdio with auth=none too, e.g. NOTION_API_KEY) */}
      {form.transportType === 'stdio' && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Environment Variables <span className="text-gray-600">(optional)</span>
          </label>
          <textarea
            value={form.envVars}
            onChange={(e) => set('envVars', e.target.value)}
            placeholder={'NOTION_API_KEY=ntn_...\nANOTHER_VAR=value'}
            rows={3}
            className="w-full rounded-lg bg-gray-900/70 border border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/40 resize-none"
          />
          <p className="text-[11px] text-gray-600 mt-1">One KEY=VALUE per line. Passed to the spawned process.</p>
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-start gap-2">
          <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <p className="text-sm text-emerald-300">{success}</p>
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={saving}
          className="bg-white/10 hover:bg-white/15 text-white border border-white/10 rounded-xl px-5 py-2 text-sm font-medium transition-all disabled:opacity-40 cursor-pointer"
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting...
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Connect Server
            </span>
          )}
        </Button>
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Delete confirmation inline
// ---------------------------------------------------------------------------

const DeleteConfirmation: React.FC<{
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}> = ({ name, onConfirm, onCancel, deleting }) => (
  <div className="bg-red-500/5 border border-red-500/15 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
    <p className="text-sm text-gray-300">
      Remove <span className="font-medium text-white">{name}</span> and all its synced tools?
    </p>
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={onCancel}
        disabled={deleting}
        className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white border border-gray-800 hover:border-gray-700 transition-all cursor-pointer"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={deleting}
        className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/20 transition-all disabled:opacity-40 cursor-pointer"
      >
        {deleting ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Removing...
          </span>
        ) : (
          'Remove'
        )}
      </button>
    </div>
  </div>
);

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
  const [deleteTarget, setDeleteTarget] = useState<McpConnectionSummary | null>(null);
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
      // silent — user can retry
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, refreshConnections]);

  const handleSync = useCallback(async (connectionId: string) => {
    await requestSync(connectionId);
  }, [requestSync]);

  const renderRefreshButton = () => (
    <Button
      type="button"
      onClick={() => {
        void refreshConnections({ manual: true });
      }}
      disabled={loading || manualRefreshing}
      className="bg-white/10 hover:bg-white/15 text-white border border-white/10 rounded-xl px-4 py-2 text-sm font-medium transition-all disabled:opacity-40 cursor-pointer"
    >
      <span className="inline-flex items-center gap-2">
        <RefreshCw className={`w-4 h-4 ${manualRefreshing ? 'animate-spin' : ''}`} />
        Refresh
      </span>
    </Button>
  );

  return (
    <SettingsShell
      title="MCP Servers"
      subtitle="Connect external tools and services via Model Context Protocol"
      icon={Plug2}
      iconColor="text-violet-400"
      mobileActions={renderRefreshButton()}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Auto-refresh stays active while syncs are in flight and revalidates again when the tab regains
          focus.
        </p>
        {renderRefreshButton()}
      </div>

      {/* Delete confirmation banner */}
      {deleteTarget && (
        <DeleteConfirmation
          name={deleteTarget.displayName}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      {/* Connected servers */}
      <SettingsSectionCard
        title="Connected Servers"
        description="MCP servers synced with your Clira agent"
        icon={<Plug2 className="w-5 h-5" />}
      >
        {loading ? (
          <div className="space-y-3">
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
          <div className="space-y-3">
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                conn={conn}
                onSync={handleSync}
                onDelete={(id) => {
                  const target = connections.find((c) => c.id === id);
                  if (target) setDeleteTarget(target);
                }}
                syncing={syncingIds.has(conn.id)}
              />
            ))}
          </div>
        )}
      </SettingsSectionCard>

      {/* Add new connection */}
      <SettingsSectionCard
        title="Add Server"
        description="Connect a new MCP-compatible server"
        icon={<Plus className="w-5 h-5" />}
      >
        <AddConnectionForm onCreated={refreshConnections} />
      </SettingsSectionCard>
    </SettingsShell>
  );
};
