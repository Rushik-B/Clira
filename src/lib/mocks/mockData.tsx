import React from 'react';
import { QueueItem, HistoryItem, Metrics, PromptVersion, Integration } from '@/types';
import { ShieldCheck, RotateCcw, X, Slack, FileText, Columns, Calendar } from 'lucide-react';

export const initialQueueItems: QueueItem[] = [
  {
    id: 'q1',
    sender: 'Alice Wonderland',
    senderAvatar: 'https://placehold.co/40x40/FEE2E2/B91C1C?text=AW',
    actionSummary: 'Auto-drafted reply to Alice about project update',
    confidence: 95,
    status: 'auto-approved',
    draftPreview: 'Hi Alice, Thanks for the update! The team is on track and we expect to deliver by EOD Friday. I\'ve attached the latest report for your review. Best, Clira',
    fullDraft: 'Hi Alice,\n\nThanks for the update! The team is on track and we expect to deliver by EOD Friday. I\'ve attached the latest report for your review.\n\nClira has also scheduled a follow-up meeting for Monday to discuss next steps.\n\nBest,\nClira',
    reason: 'Pattern: 5/5 past approvals for similar internal updates from Alice. High confidence in sentiment and content match.',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: 'q2',
    sender: 'Bob The Builder',
    senderAvatar: 'https://placehold.co/40x40/D1FAE5/065F46?text=BB',
    actionSummary: 'Needs approval: Schedule urgent meeting with Bob',
    confidence: 75,
    status: 'needs-attention',
    draftPreview: 'Bob, Clira suggests scheduling an urgent meeting to discuss the Q3 budget concerns. Available slots: Tomorrow 10 AM, 2 PM. Please confirm.',
    fullDraft: 'Hi Bob,\n\nClira suggests scheduling an urgent meeting to discuss the Q3 budget concerns you raised in your last email.\n\nProposed available slots:\n- Tomorrow at 10:00 AM PST\n- Tomorrow at 2:00 PM PST\n\nPlease let me know which time works best for you, or suggest an alternative.\n\nBest,\nClira',
    reason: 'Urgent keyword detected. Sender is high priority. Confidence moderate due to scheduling complexity.',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: 'q3',
    sender: 'Cathy The Coder',
    senderAvatar: 'https://placehold.co/40x40/E0E7FF/3730A3?text=CC',
    actionSummary: 'Snoozed: Follow up with Cathy on API documentation',
    confidence: 80,
    status: 'snoozed',
    draftPreview: 'Reminder to follow up with Cathy regarding the API documentation by EOW.',
    fullDraft: 'This is a snoozed item. Clira will remind you to follow up with Cathy regarding the API documentation by the end of the week.',
    reason: 'Snoozed by user until Friday.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: 'q4',
    sender: 'David Director',
    senderAvatar: 'https://placehold.co/40x40/FEF3C7/92400E?text=DD',
    actionSummary: 'Manual Action: Review complex legal document from David',
    confidence: 40,
    status: 'manual',
    draftPreview: 'David sent a new MSA for review. Clira recommends manual review due to legal complexities.',
    fullDraft: 'Hi Team,\n\nDavid Director has sent over the new Master Service Agreement for Project Titan. Given the legal implications and specific clauses related to IP rights, Clira recommends a thorough manual review by the legal team before any automated processing or response.\n\nPlease prioritize this review.\n\nBest,\nClira',
    reason: 'Detected complex legal jargon and terms requiring human expertise. Low confidence for automated action.',
    timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
];

export const mockHistoryItems: HistoryItem[] = [
  { 
    id: 'h1', 
    statusIcon: <ShieldCheck className="text-emerald-500" />, 
    timestamp: '11:24 AM', 
    summary: 'Auto-replied to Bob - Q2 roadmap', 
    fullContext: 'Full context for Bob\'s Q2 roadmap reply...', 
    promptState: 'Previous prompt state...', 
    feedback: 'No feedback provided.' 
  },
  { 
    id: 'h2', 
    statusIcon: <RotateCcw className="text-blue-500" />, 
    timestamp: '10:50 AM', 
    summary: 'Snoozed follow-up with Charlie', 
    fullContext: 'Full context for snoozed item...', 
    promptState: 'N/A', 
    feedback: 'Snoozed for 3 days.' 
  },
  { 
    id: 'h3', 
    statusIcon: <X className="text-red-500" />, 
    timestamp: 'Yesterday', 
    summary: 'Rejected draft for Project Phoenix kickoff', 
    fullContext: 'Full context for rejected draft...', 
    promptState: 'Initial draft for kickoff email.', 
    feedback: 'Tone was too informal.' 
  },
  { 
    id: 'h4', 
    statusIcon: <ShieldCheck className="text-emerald-500" />, 
    timestamp: 'Yesterday', 
    summary: 'Auto-archived newsletter from "Tech Weekly"', 
    fullContext: 'Newsletter archived based on rules.', 
    promptState: 'N/A', 
    feedback: 'Rule: Archive newsletters older than 7 days.' 
  },
];

export const mockMetrics: Metrics = {
  autonomyOverTime: [60, 65, 70, 75, 72, 78, 80, 82],
  keyMetrics: {
    emailsHandled: 157,
    averageConfidence: '78%',
    timeSaved: '4h 30m',
    errorRate: '2.5%',
    editsNeeded: 18,
  },
  autonomyBreakdown: { auto: 70, manual: 20, snoozed: 10 },
};

export const mockPromptVersions: PromptVersion[] = [
  { 
    id: 'pv3', 
    version: 3, 
    date: '2024-05-28', 
    editor: 'Alex Chen', 
    reason: 'Increased formality for client comms.', 
    active: true, 
    settings: { tone: 'Professional', formality: 'High', signOff: 'Sincerely, {UserName}', emojiUsage: 0 } 
  },
  { 
    id: 'pv2', 
    version: 2, 
    date: '2024-05-25', 
    editor: 'Clira (Auto-tune)', 
    reason: 'Optimized for conciseness based on recent edits.', 
    active: false, 
    settings: { tone: 'Friendly', formality: 'Medium', signOff: 'Best, {UserName}', emojiUsage: 2 } 
  },
  { 
    id: 'pv1', 
    version: 1, 
    date: '2024-05-20', 
    editor: 'Alex Chen', 
    reason: 'Initial setup.', 
    active: false, 
    settings: { tone: 'Friendly', formality: 'Low', signOff: 'Thanks, {UserName}', emojiUsage: 3 } 
  },
];

export const mockIntegrations: Integration[] = [
  { id: 'slack', name: 'Slack', icon: Slack, connected: true, scope: 'Read messages, Send replies', lastSync: '5m ago' },
  { id: 'notion', name: 'Notion', icon: FileText, connected: true, scope: 'Read pages, Create notes', lastSync: '1h ago' },
  { id: 'jira', name: 'Jira', icon: Columns, connected: false, scope: 'Read issues, Update status', lastSync: 'Never' },
  { id: 'calendar', name: 'Google Calendar', icon: Calendar, connected: true, scope: 'Read events, Create events', lastSync: 'Just now' },
]; 