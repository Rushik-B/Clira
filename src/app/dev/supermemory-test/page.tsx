'use client';

/**
 * Supermemory Bootstrap Test UI
 *
 * Visual interface for testing the Supermemory bootstrap process.
 * Displays all generated summaries, profile, and metrics.
 */

import { useState } from 'react';

interface TestConfig {
  maxSentEmails: number;
  budgetTokens: number;
}

export default function SupermemoryTestPage() {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<TestConfig>({
    maxSentEmails: 50,
    budgetTokens: 10000,
  });

  if (!isDevelopment) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-3xl mx-auto bg-white shadow rounded-lg p-6">
          <h1 className="text-2xl font-semibold text-gray-900">Not available</h1>
          <p className="mt-2 text-gray-600">This page is only available in development.</p>
        </div>
      </div>
    );
  }

  const runTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/dev/supermemory-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Test failed');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🧠 Supermemory Bootstrap Test Harness
          </h1>
          <p className="text-gray-600">
            Test the bootstrap process and inspect generated summaries before calling Supermemory
            API
          </p>
        </div>

        {/* Config */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Sent Emails
              </label>
              <input
                type="number"
                value={config.maxSentEmails}
                onChange={(e) =>
                  setConfig({ ...config, maxSentEmails: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Token Budget
              </label>
              <input
                type="number"
                value={config.budgetTokens}
                onChange={(e) => setConfig({ ...config, budgetTokens: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>
          <button
            onClick={runTest}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 font-medium"
          >
            {loading ? '⏳ Running Test...' : '🚀 Run Bootstrap Test'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <h3 className="text-red-800 font-semibold mb-2">❌ Error</h3>
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Summary Metrics */}
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">📊 Summary Metrics</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="Threads Processed"
                  value={result.result.summary?.threadsProcessed || result.result.threadsProcessed}
                  color="blue"
                />
                <MetricCard
                  label="Episodes Generated"
                  value={result.result.generatedContent?.episodes.length || 0}
                  color="green"
                />
                <MetricCard
                  label="Tokens Used"
                  value={result.result.estimatedTokensUsed}
                  suffix={`/${config.budgetTokens}`}
                  color="purple"
                />
                <MetricCard
                  label="Duration"
                  value={result.result.durationMs}
                  suffix="ms"
                  color="orange"
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <StatCard
                  label="Fetch Success"
                  value={result.result.generatedContent?.threadFetchStats.success || 0}
                  color="text-green-600"
                />
                <StatCard
                  label="Fetch Empty"
                  value={result.result.generatedContent?.threadFetchStats.empty || 0}
                  color="text-yellow-600"
                />
                <StatCard
                  label="Fetch Failed"
                  value={result.result.generatedContent?.threadFetchStats.failed || 0}
                  color="text-red-600"
                />
              </div>
            </div>

            {/* User Profile */}
            {result.result.generatedContent?.profile && (
              <div className="bg-white shadow rounded-lg p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">👤 Generated User Profile</h2>
                <div className="bg-gray-50 p-4 rounded-md">
                  <pre className="text-sm overflow-x-auto">
                    {JSON.stringify(result.result.generatedContent.profile, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Episode Summaries */}
            {result.result.generatedContent?.episodes && (
              <div className="bg-white shadow rounded-lg p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">
                  📧 Generated Episode Summaries ({result.result.generatedContent.episodes.length})
                </h2>
                <div className="space-y-4 max-h-[800px] overflow-y-auto">
                  {result.result.generatedContent.episodes.map((episode: any, idx: number) => (
                    <EpisodeCard key={episode.threadId} episode={episode} index={idx} />
                  ))}
                </div>
              </div>
            )}

            {/* Raw JSON */}
            <details className="bg-white shadow rounded-lg p-6">
              <summary className="text-xl font-semibold cursor-pointer">
                🔍 Raw JSON Output (Click to expand)
              </summary>
              <div className="mt-4 bg-gray-50 p-4 rounded-md">
                <pre className="text-xs overflow-x-auto">
                  {JSON.stringify(result.result, null, 2)}
                </pre>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

// Helper Components

function MetricCard({
  label,
  value,
  suffix = '',
  color,
}: {
  label: string;
  value: number;
  suffix?: string;
  color: string;
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
  };

  return (
    <div className={`border rounded-lg p-4 ${colorClasses[color as keyof typeof colorClasses]}`}>
      <div className="text-2xl font-bold">
        {value}
        {suffix && <span className="text-sm font-normal">{suffix}</span>}
      </div>
      <div className="text-sm font-medium mt-1">{label}</div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-gray-600">{label}</div>
    </div>
  );
}

function EpisodeCard({ episode, index }: { episode: any; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">
            #{index + 1}: {episode.subject}
          </h3>
          <div className="text-sm text-gray-600 mt-1">
            Thread ID: {episode.threadId} | Messages: {episode.messageCount} | Tokens:{' '}
            {episode.actualTokens}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-blue-600 hover:text-blue-800 font-medium text-sm"
        >
          {expanded ? '▼ Collapse' : '▶ Expand'}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Sent Summary */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-1">
              📤 Sent Email Summary ({episode.content.sent_email_summary.length} chars)
            </div>
            <div className="bg-blue-50 p-3 rounded-md text-sm text-gray-800">
              {episode.content.sent_email_summary}
            </div>
          </div>

          {/* Received Summary */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-1">
              📥 Received Thread Summary ({episode.content.received_thread_summary.length} chars)
            </div>
            <div className="bg-green-50 p-3 rounded-md text-sm text-gray-800">
              {episode.content.received_thread_summary}
            </div>
          </div>

          {/* Metadata */}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-gray-700">
              Metadata & Participants
            </summary>
            <div className="mt-2 bg-gray-50 p-3 rounded-md">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="font-medium">From:</span>{' '}
                  {episode.participants.fromAddresses.join(', ')}
                </div>
                <div>
                  <span className="font-medium">To:</span>{' '}
                  {episode.participants.toAddresses.join(', ')}
                </div>
                <div>
                  <span className="font-medium">Started:</span>{' '}
                  {new Date(episode.threadStartAt).toLocaleString()}
                </div>
                <div>
                  <span className="font-medium">Last:</span>{' '}
                  {new Date(episode.threadLastAt).toLocaleString()}
                </div>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
