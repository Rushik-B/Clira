'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  Wand2,
  Brain,
  Save,
  History,
  Info,
  Lightbulb,
  Zap,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { usePageData } from '@/contexts/PageDataContext';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { PageHeader } from '@/components/ui/PageHeader';
import { MobileHeader } from '@/components/ui/MobileHeader';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
interface MasterPrompt {
  id: string;
  prompt: string;
  version: number;
  isActive: boolean;
  isGenerated?: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                              */
/* ------------------------------------------------------------------ */
const tabs = [
  { id: 'master-prompt', label: 'Master Prompt', icon: Wand2, color: 'blue' },
] as const;
type TabId = typeof tabs[number]['id'];
type TabColor = typeof tabs[number]['color'];

interface TabTone {
  active: string;
  inactive: string;
  focus: string;
  iconActive: string;
  iconInactive: string;
  spinner: string;
}

const TAB_BUTTON_BASE_CLASSES =
  'group flex items-center flex-1 min-w-0 w-full justify-center gap-2 px-4 py-3 sm:px-5 sm:py-3 h-12 sm:h-11 text-xs sm:text-sm font-bold tracking-tight';

const tabTones: Record<TabColor, TabTone> = {
  blue: {
    active: 'text-blue-100 shadow-[0_22px_70px_-42px_rgba(59,130,246,0.85)]',
    inactive:
      'text-blue-200/80 hover:text-blue-100 hover:shadow-[0_18px_60px_-44px_rgba(59,130,246,0.8)]',
    focus: 'focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-0',
    iconActive: 'text-blue-100',
    iconInactive: 'text-blue-300/80 group-hover:text-blue-100',
    spinner: 'border-t-blue-400',
  },
};


/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export const VoiceRulesPage: React.FC = () => {
  const { data: session } = useSession();

  /* ---------------------------- state ---------------------------- */
  const [activeTab, setActiveTab] = useState<TabId>('master-prompt');

  // Master Prompt
  const [currentPrompt, setCurrentPrompt] = useState<MasterPrompt | null>(null);
  const [promptHistory, setPromptHistory] = useState<MasterPrompt[]>([]);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null); // For version selection


  // Misc UI
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Simple loading state for the active tab
  const [activeTabLoading, setActiveTabLoading] = useState(false);

  // Test AI - removed unused variables

  /* ------------------------- side effects ------------------------- */
  useEffect(() => {
    if (!session) return;
    // Start with loading state for the first tab
    setActiveTabLoading(true);
    fetchCurrentPrompt();
    fetchPromptHistory();
  }, [session]);

  /* --------------------------- helpers --------------------------- */
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const getTabButtonClasses = (tabId: TabId, isActive: boolean) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return cn(LIQUID_BUTTON_BASE_CLASS, TAB_BUTTON_BASE_CLASSES);

    const tone = tabTones[tab.color];
    const stateClasses = isActive ? tone.active : tone.inactive;

    return cn(
      LIQUID_BUTTON_BASE_CLASS,
      TAB_BUTTON_BASE_CLASSES,
      'transition-all duration-300 ease-out backdrop-blur-sm',
      'focus-visible:outline-none',
      tone.focus,
      stateClasses,
    );
  };

  const getTabIconClasses = (tabId: TabId, isActive: boolean) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return 'w-4 h-4 flex-shrink-0';

    const tone = tabTones[tab.color];
    return cn(
      'w-4 h-4 flex-shrink-0 transition-colors duration-200 ease-out',
      isActive ? tone.iconActive : tone.iconInactive,
    );
  };

  const getTabSpinnerClasses = (tabId: TabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab)
      return 'inline-flex h-3 w-3 items-center justify-center border-2 border-white/20 border-t-blue-400 rounded-full animate-spin ml-2 flex-shrink-0';

    const tone = tabTones[tab.color];
    return cn(
      'inline-flex h-3 w-3 items-center justify-center border-2 border-white/25 rounded-full animate-spin ml-2 flex-shrink-0',
      tone.spinner,
    );
  };

  /* ---------------------- fetch / save logic ---------------------- */
  const fetchCurrentPrompt = async () => {
    setActiveTabLoading(true);
    try {
      const r = await fetch('/api/master-prompt');
      if (!r.ok) throw new Error();
      const data = await r.json();
      setCurrentPrompt(data);
      setEditedPrompt(data.prompt);
      setIsDefault(!!data.isDefault);
    } catch {
      setError('Failed to fetch Master Prompt');
    } finally {
      setActiveTabLoading(false);
    }
  };
  const fetchPromptHistory = async () => {
    try {
      const r = await fetch('/api/master-prompt/history');
      if (!r.ok) throw new Error();
      const data = await r.json();
      setPromptHistory(data.prompts || []);
    } catch {
      console.error('Failed to fetch prompt history');
    }
  };

  const savePrompt = async () => {
    if (!editedPrompt.trim()) {
      setError('Prompt cannot be empty');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const method =
        currentPrompt?.isGenerated && currentPrompt?.id ? 'PUT' : 'POST';
      const body =
        method === 'PUT'
          ? {
              prompt: editedPrompt.trim(),
              promptId: currentPrompt?.id,
              isDistilledEdit: true,
            }
          : { prompt: editedPrompt.trim() };
      const r = await fetch('/api/master-prompt', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await fetchCurrentPrompt();
      await fetchPromptHistory();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };


  const activatePromptVersion = async (promptId: string) => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/master-prompt/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptId }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await fetchCurrentPrompt();
      await fetchPromptHistory();
      setSelectedPromptId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Activation failed');
    } finally {
      setSaving(false);
    }
  };

  const selectPromptVersion = (promptId: string) => {
    const selected = promptHistory.find((p) => p.id === promptId);
    if (selected) {
      setSelectedPromptId(promptId);
      setEditedPrompt(selected.prompt);
    }
  };

  /* -------------------------- rendering -------------------------- */

  // No more full-screen loading - UI shows immediately

  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Mobile Header - Fixed */}
      <MobileHeader title="Voice & Rules">
        <LiquidButton
          onClick={() => {
            if (activeTab === 'master-prompt') {
              fetchCurrentPrompt();
              fetchPromptHistory();
            }
          }}
          minWidth="none"
          size="icon"
          className="h-8 w-8 rounded-full text-sky-100"
          aria-label="Refresh content"
          variant="default"
          type="button"
        >
          <RefreshCw size={14} />
        </LiquidButton>
      </MobileHeader>
      <div className="flex-1">
        {/* Prompt-History modal */}
        {showHistory && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden border border-gray-800">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                <h3 className="text-sm font-semibold text-white flex items-center">
                  <History className="w-4 h-4 mr-2" />
                  Prompt History
                </h3>
                <LiquidButton
                  onClick={() => setShowHistory(false)}
                  minWidth="sm"
                  variant="default"
                  size="sm"
                  className="rounded-xl px-3 text-sm font-semibold text-sky-100"
                  type="button"
                >
                  &times;
                </LiquidButton>
              </div>
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="min-w-full text-xs text-left">
                  <thead className="bg-gray-800 border-b border-gray-700">
                    <tr>
                      <th className="px-4 py-2 font-medium text-gray-300">Version</th>
                      <th className="px-4 py-2 font-medium text-gray-300">Date</th>
                      <th className="px-4 py-2 font-medium text-gray-300">Source</th>
                      <th className="px-4 py-2 font-medium text-gray-300">Chars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promptHistory.map((p) => (
                      <tr key={p.id} className="border-b border-gray-800 even:bg-gray-800/50">
                        <td className="px-4 py-2 text-gray-200">v{p.version}</td>
                        <td className="px-4 py-2 text-gray-400">{formatDate(p.createdAt)}</td>
                        <td className="px-4 py-2 text-gray-400">
                          {p.isGenerated ? 'AI' : 'Manual'}
                        </td>
                        <td className="px-4 py-2 text-gray-400">{p.prompt.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================= Page ========================= */}
        <div className="flex-1 space-y-6 sm:space-y-8 w-full max-w-none p-4 sm:p-8 pt-24 sm:pt-8 relative z-10 overflow-x-hidden">
          {/* Header */}
          <PageHeader
            title="Voice and Rules Configuration"
            subtitle="Take complete control over your AI assistant. These prompts and data are sent directly to the AI with every email."
            icon={Brain}
            iconColor="text-blue-500"
          />

          {/* Educational Banner */}
          <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-800 rounded-2xl p-6">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <Lightbulb className="w-6 h-6 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-blue-100 mb-2">
                  🎛️ You Have Complete Control Over Your AI
                </h3>
                <p className="text-blue-200 text-sm leading-relaxed mb-3">
                  Everything you see here is <strong>automatically generated from your own emails</strong> and then sent directly to the AI with every request. 
                  When you modify these prompts, you're literally changing the instructions your AI receives.
                </p>
                <div className="flex flex-col sm:grid sm:grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 text-sm">
                  <div className="flex items-start space-x-2">
                    <Wand2 className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <span className="text-blue-300 min-w-0"><strong>Master Prompt:</strong> AI's personality & style guide</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col xl:grid xl:grid-cols-4 gap-6 xl:gap-8">
            {/* =================== Editor + Tabs ===================== */}
            <div className="xl:col-span-3 space-y-6 min-w-0">
              {/* Tabs */}
              <div
                id="voice-tabs-container"
                className="flex flex-col gap-2 sm:flex-row sm:gap-3"
              >
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <LiquidButton
                      key={tab.id}
                      type="button"
                      data-testid={`voice-tab-${tab.id}`}
                      variant="default"
                      size="lg"
                      minWidth="none"
                      responsive
                      aria-pressed={isActive}
                      className={getTabButtonClasses(tab.id, isActive)}
                      onClick={() => {
                        setActiveTab(tab.id);
                        // Set loading when switching tabs
                        if (tab.id === 'master-prompt' && !currentPrompt) {
                          setActiveTabLoading(true);
                        }
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Icon className={getTabIconClasses(tab.id, isActive)} />
                        <span className="text-xs sm:text-sm font-extrabold tracking-tight truncate">
                          {tab.label}
                        </span>
                        {activeTabLoading && activeTab === tab.id && (
                          <span className={getTabSpinnerClasses(tab.id)} />
                        )}
                      </span>
                    </LiquidButton>
                  );
                })}
              </div>

              {/* --------------- MASTER PROMPT ----------------------- */}
              {activeTab === 'master-prompt' && (
                <div className="relative group animate-in fade-in duration-300">
                  <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                  <div id="master-prompt-container" className="relative bg-gray-900 border-2 border-gray-800/60 rounded-2xl p-8 shadow-xl backdrop-blur-sm">
                    <GlowingEffect
                      blur={0}
                      borderWidth={2}
                      spread={40}
                      glow={true}
                      disabled={false}
                      proximity={70}
                      inactiveZone={0.02}
                      movementDuration={1.5}
                    />
                  {/* header */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-blue-900/30 rounded-xl flex items-center justify-center border-2 border-blue-700/40">
                        <Wand2 className="w-6 h-6 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-white">
                          Master Prompt{' '}
                          {isDefault && <span className="text-sm text-gray-400">(Default)</span>}
                        </h3>
                        {currentPrompt?.isGenerated && (
                          <span className="text-sm text-blue-400 font-medium">AI-Generated from Your Emails</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setShowHistory(true)}
                        className="flex items-center px-3 py-2 text-sm text-gray-400 hover:text-blue-400 hover:bg-blue-900/20 border-2 border-transparent hover:border-blue-700/40 rounded-lg transition-colors cursor-pointer transform hover:-translate-y-0.5"
                    >
                      <History className="w-4 h-4 mr-1" />
                      History
                    </button>
                  </div>

                  {/* Educational Info */}
                    <div className="mb-6 p-5 bg-gradient-to-r from-blue-900/20 to-blue-800/20 border-2 border-blue-800/60 rounded-xl backdrop-blur-sm">
                    <div className="flex items-start space-x-3">
                      <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-blue-200">
                        <p className="font-semibold mb-2">🧠 This is your AI's brain!</p>
                        <p className="mb-3">This text is sent <strong>directly to the AI</strong> with every email. It tells your AI:</p>
                        <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2 text-xs">
                          <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full flex-shrink-0 mt-1.5"></div>
                            <span className="min-w-0">How you write (tone, style, formality)</span>
                          </div>
                          <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full flex-shrink-0 mt-1.5"></div>
                            <span className="min-w-0">Your communication preferences</span>
                          </div>
                          <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full flex-shrink-0 mt-1.5"></div>
                            <span className="min-w-0">How to format responses</span>
                          </div>
                          <div className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full flex-shrink-0 mt-1.5"></div>
                            <span className="min-w-0">What to include or avoid</span>
                          </div>
                        </div>
                        <p className="mt-3 text-xs font-semibold bg-blue-800/50 px-3 py-1 rounded-full inline-block">
                          Every word you change here directly impacts how your AI responds!
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* textarea */}
                    <div className="mb-6">
                      {activeTabLoading && activeTab === 'master-prompt' ? (
                        <div className="w-full min-h-[1200px] p-6 bg-gray-900/60 border-2 border-gray-700/50 rounded-xl flex items-center justify-center">
                          <div className="text-center">
                            <div className="relative w-12 h-12 mx-auto mb-4">
                              <div className="w-12 h-12 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
                            </div>
                            <p className="text-sm text-gray-400">Loading your AI's personality...</p>
                          </div>
                        </div>
                      ) : (
                        <textarea
                          value={editedPrompt}
                          onChange={(e) => setEditedPrompt(e.target.value)}
                          placeholder="Enter your AI's personality instructions here…"
                          className="w-full min-h-[1200px] p-6 bg-gray-900/60 border-2 border-gray-700/50 rounded-xl resize-none font-mono text-sm leading-relaxed focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 focus:bg-gray-900/70 transition-colors text-white placeholder-gray-500 backdrop-blur-sm shadow-inner"
                          data-testid="master-prompt-editor"
                        />
                      )}
                    </div>

                  {error && (
                    <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-xl text-sm text-red-400 flex items-start space-x-3">
                      <div className="w-5 h-5 bg-red-800 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-red-400 text-xs">!</span>
                      </div>
                      <div>{error}</div>
                    </div>
                  )}

                  {/* footer */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-0 pt-4 border-t border-gray-800/60">
                    <div className="flex items-center space-x-6 min-w-0">
                      <span className="text-sm font-medium text-gray-300">
                        {editedPrompt.length.toLocaleString()} characters
                      </span>
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">Changes take effect immediately</span>
                    </div>
                    <PrimaryButton
                      onClick={savePrompt}
                      disabled={isSaving || !editedPrompt.trim()}
                      minWidth="lg"
                      className="w-full sm:w-auto"
                    >
                      <Save size={16} className="mr-2" />
                      {isSaving ? 'Saving…' : 'Save Changes'}
                    </PrimaryButton>
                  </div>
                  </div>
                </div>
              )}

            </div>

            {/* ====================== Sidebar (Prompt Versions) ============== */}
            <div className="xl:col-span-1 space-y-6 min-w-0">
              {/* Educational Panel */}
              <div className="relative group">
                <div className="absolute -inset-2 bg-gradient-to-br from-blue-500/10 via-purple-400/15 to-blue-500/10 rounded-2xl blur-lg opacity-60"></div>
                <div className="relative bg-gradient-to-br from-blue-900/30 to-purple-900/30 border-2 border-blue-800/60 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm min-w-0">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base sm:text-lg font-semibold text-white flex items-center min-w-0">
                    <Settings className="w-4 sm:w-5 h-4 sm:h-5 mr-2 text-blue-400 flex-shrink-0" />
                    <span className="truncate">Your Control</span>
                  </h3>
                </div>
                
                <div className="space-y-4 text-sm">
                  <div className="flex items-start space-x-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-100">Direct AI Control</p>
                      <p className="text-gray-400 text-xs leading-relaxed break-words">Every change you make is sent directly to the AI with your emails</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 flex-shrink-0"></div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-100">Your Data Only</p>
                      <p className="text-gray-400 text-xs leading-relaxed break-words">Generated from YOUR emails, for YOUR unique style and contacts</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-100">Instant Updates</p>
                      <p className="text-gray-400 text-xs leading-relaxed break-words">Changes take effect immediately - no waiting or delays</p>
                    </div>
                  </div>
                </div>
                </div>
              </div>

              {/* Version Management Panel */}
              <div className="relative group">
                <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 via-blue-400/15 to-blue-500/10 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                <div className="relative bg-gray-900 border-2 border-gray-800/60 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm min-w-0">
                <div className="flex items-center justify-between mb-4 min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-white flex items-center min-w-0">
                    <History className="w-4 sm:w-5 h-4 sm:h-5 mr-2 text-blue-400 flex-shrink-0" />
                    <span className="truncate">Prompt Versions</span>
                  </h3>
                  {currentPrompt && (
                    <span className="text-xs sm:text-sm bg-blue-900/30 text-blue-400 px-2 sm:px-3 py-1 rounded-full font-medium flex-shrink-0">
                      v{currentPrompt.version}
                    </span>
                  )}
                </div>
                
                {/* Current Active Version */}
                {currentPrompt && (
                  <div className="mb-4 p-3 bg-green-900/20 border-2 border-green-800/60 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-green-400">Active Version</span>
                      <span className="text-xs text-green-500">v{currentPrompt.version}</span>
                    </div>
                    <p className="text-xs text-green-300">
                      {currentPrompt.isGenerated ? 'AI-Generated' : 'Manual'} • {formatDate(currentPrompt.createdAt)}
                    </p>
                    <p className="text-xs text-green-400 mt-1">
                      {currentPrompt.prompt.length} characters
                    </p>
                  </div>
                )}

                {/* Version History List */}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">Version History</h4>
                  {promptHistory.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No version history available</p>
                  ) : (
                    promptHistory.map((prompt) => (
                      <div
                        key={prompt.id}
                        className={`p-3 border-2 rounded-lg cursor-pointer transition-all duration-200 transform hover:-translate-y-0.5 ${
                          selectedPromptId === prompt.id
                            ? 'border-blue-600 bg-blue-900/20'
                            : prompt.isActive
                            ? 'border-green-600 bg-green-900/20'
                            : 'border-gray-700 bg-gray-800 hover:bg-gray-700'
                        }`}
                        onClick={() => selectPromptVersion(prompt.id)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-100">
                            v{prompt.version}
                          </span>
                          <div className="flex items-center space-x-1">
                            {prompt.isActive && (
                              <span className="text-xs bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded">
                                Active
                              </span>
                            )}
                            {selectedPromptId === prompt.id && (
                              <span className="text-xs bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">
                                Selected
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mb-1">
                          {prompt.isGenerated ? 'AI-Generated' : 'Manual'} • {formatDate(prompt.createdAt)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {prompt.prompt.length} chars
                        </p>
                        <p className="text-xs text-gray-400 mt-1 overflow-hidden">
                          <span className="block truncate">
                            {prompt.prompt.substring(0, 100)}...
                          </span>
                        </p>
                      </div>
                    ))
                  )}
                </div>

                {/* Action Buttons */}
                {selectedPromptId && selectedPromptId !== currentPrompt?.id && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <div className="flex space-x-2">
                      <PrimaryButton
                        onClick={() => activatePromptVersion(selectedPromptId)}
                        disabled={isSaving}
                        minWidth="md"
                        className="!bg-[hsl(var(--sidebar-primary))] !text-[hsl(var(--sidebar-primary-foreground))] hover:!bg-[hsl(var(--sidebar-primary))] hover:brightness-110 active:brightness-95 focus-visible:ring-[hsl(var(--sidebar-primary)/0.35)] flex-1"
                      >
                        <Wand2 className="w-4 h-4 mr-1" />
                        {isSaving ? 'Activating...' : 'Activate'}
                      </PrimaryButton>
                      <LiquidButton
                        onClick={() => {
                          setSelectedPromptId(null);
                          setEditedPrompt(currentPrompt?.prompt || '');
                        }}
                        minWidth="sm"
                        responsive
                        variant="default"
                        size="lg"
                        className={LIQUID_BUTTON_BASE_CLASS}
                        type="button"
                      >
                        Cancel
                      </LiquidButton>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      This will make the selected version active and update your AI's behavior immediately
                    </p>
                  </div>
                )}
                </div>
              </div>

              {/* Quick Stats */}
              <div className="relative group">
                <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/10 via-purple-400/15 to-purple-500/10 rounded-2xl blur-lg opacity-60"></div>
                <div className="relative bg-gray-900 border-2 border-gray-800/60 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm min-w-0">
                <h3 className="text-base sm:text-lg font-semibold text-white mb-4 flex items-center min-w-0">
                  <Brain className="w-4 sm:w-5 h-4 sm:h-5 mr-2 text-purple-400 flex-shrink-0" />
                  <span className="truncate">Quick Stats</span>
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Total Versions</span>
                    <span className="text-sm font-semibold text-gray-200 bg-gray-800 px-2 py-1 rounded-full">{promptHistory.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">AI Generated</span>
                    <span className="text-sm font-semibold text-blue-400 bg-blue-900/30 px-2 py-1 rounded-full">
                      {promptHistory.filter(p => p.isGenerated).length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Manual</span>
                    <span className="text-sm font-semibold text-green-400 bg-green-900/30 px-2 py-1 rounded-full">
                      {promptHistory.filter(p => !p.isGenerated).length}
                    </span>
                  </div>
                  {currentPrompt && (
                    <div className="flex justify-between items-center pt-3 border-t border-gray-800">
                      <span className="text-sm text-gray-400">Current Length</span>
                      <span className="text-sm font-semibold text-purple-400 bg-purple-900/30 px-2 py-1 rounded-full">{currentPrompt.prompt.length.toLocaleString()}</span>
                    </div>
                  )}
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
};
