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
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/sidebar/button';
import { Input } from '@/components/ui/sidebar/input';
import { SettingsShell, SettingsSectionCard } from './SettingsShell';

// ---------------------------------------------------------------------------
// Types (only what the UI needs — keeps the component self-contained)
// ---------------------------------------------------------------------------

type ConnectionStatus = 'pending' | 'synced' | 'degraded' | 'disabled';
type TransportType = 'stdio' | 'streamable_http';
type AuthMode = 'none' | 'bearer_token' | 'static_header';

interface McpConnectionSummary {
  id: string;
  serverKey: string;
  displayName: string;
  status: ConnectionStatus;
  transport: { type: TransportType };
  degradedReason: string | null;
  toolCount: number;
  capabilities: string[];
  healthy: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
}

interface McpToolSummary {
  id: string;
  toolName: string;
  displayTitle: string;
  description: string | null;
  actionClass: string;
  capabilityId: string;
  safeForAutoUse: boolean;
}

interface ConnectionDetail {
  connection: McpConnectionSummary;
  tools: McpToolSummary[];
}

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
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
  syncing: boolean;
}> = ({ conn, onSync, onDelete, syncing }) => {
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<McpToolSummary[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);

  const toggleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (tools !== null) return;

    setLoadingTools(true);
    try {
      const res = await fetch(`/api/mcp/connections/${conn.id}`);
      const data = await res.json();
      if (data.success && data.connection) {
        // The detail endpoint returns the connection; tools come from registry
        // Fall back to empty if tools aren't included
        setTools(data.tools ?? []);
      }
    } catch {
      // silently degrade — tools section stays empty
    } finally {
      setLoadingTools(false);
    }
  }, [expanded, tools, conn.id]);

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
            onClick={() => onSync(conn.id)}
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
  authMode: AuthMode;
  bearerToken: string;
  headerName: string;
  headerValue: string;
  envVars: string;
}

const INITIAL_FORM: AddFormState = {
  displayName: '',
  serverKey: '',
  transportType: 'stdio',
  command: '',
  args: '',
  endpoint: '',
  authMode: 'none',
  bearerToken: '',
  headerName: '',
  headerValue: '',
  envVars: '',
};

const AddConnectionForm: React.FC<{
  onCreated: () => void;
}> = ({ onCreated }) => {
  const [form, setForm] = useState<AddFormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const set = useCallback(
    <K extends keyof AddFormState>(key: K, value: AddFormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

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
            };

      // Parse env vars (KEY=VALUE per line)
      const envEntries = form.envVars
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const eqIdx = line.indexOf('=');
          if (eqIdx === -1) return null;
          return [line.slice(0, eqIdx), line.slice(eqIdx + 1)] as [string, string];
        })
        .filter((entry): entry is [string, string] => entry !== null);
      const env = envEntries.length > 0 ? Object.fromEntries(envEntries) : undefined;

      let secrets: Record<string, unknown>;
      if (form.authMode === 'bearer_token') {
        secrets = { authMode: 'bearer_token', bearerToken: form.bearerToken, env };
      } else if (form.authMode === 'static_header') {
        secrets = {
          authMode: 'static_header',
          headerName: form.headerName,
          headerValue: form.headerValue,
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
        setForm(INITIAL_FORM);
        onCreated();
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
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Endpoint URL</label>
          <Input
            value={form.endpoint}
            onChange={(e) => set('endpoint', e.target.value)}
            placeholder="https://your-server.com/mcp"
            className="bg-gray-900/70 border-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
          />
        </div>
      )}

      {/* Auth mode */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-2">Authentication</label>
        <div className="flex gap-2 flex-wrap">
          {([
            ['none', 'None'],
            ['bearer_token', 'Bearer Token'],
            ['static_header', 'Custom Header'],
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
  const [connections, setConnections] = useState<McpConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<McpConnectionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchConnections = useCallback(async () => {
    try {
      setError('');
      const res = await fetch('/api/mcp/connections');
      const data = await res.json();
      if (data.success) {
        setConnections(data.connections ?? []);
      } else {
        setError(data.error ?? 'Failed to load connections.');
      }
    } catch {
      setError('Network error loading connections.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleSync = useCallback(async (connectionId: string) => {
    setSyncingIds((prev) => new Set(prev).add(connectionId));
    try {
      await fetch('/api/mcp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      // Wait a moment for sync to process, then refresh
      setTimeout(() => {
        fetchConnections();
        setSyncingIds((prev) => {
          const next = new Set(prev);
          next.delete(connectionId);
          return next;
        });
      }, 2000);
    } catch {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    }
  }, [fetchConnections]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/mcp/connections/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setDeleteTarget(null);
        fetchConnections();
      }
    } catch {
      // silent — user can retry
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, fetchConnections]);

  return (
    <SettingsShell
      title="MCP Servers"
      subtitle="Connect external tools and services via Model Context Protocol"
      icon={Plug2}
      iconColor="text-violet-400"
    >
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
          <ErrorBanner message={error} onRetry={fetchConnections} />
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
        <AddConnectionForm onCreated={fetchConnections} />
      </SettingsSectionCard>
    </SettingsShell>
  );
};
