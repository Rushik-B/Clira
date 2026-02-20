'use client';

import React, { useState, useEffect } from 'react';
import { Send, Loader2, CheckCircle, AlertCircle, Copy, RefreshCw, Mail, Filter, MessageSquare, Code, Layout } from 'lucide-react';
import { useSession } from 'next-auth/react';

interface EmailTemplate {
  name: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  description: string;
}

const emailTemplates: EmailTemplate[] = [
  {
    name: 'Project Update',
    from: 'sarah.chen@company.com',
    to: ['me@company.com'],
    subject: 'Q4 Campaign Status Update?',
    body: "Hey,\n\nHope you're doing well! Just wanted to check in on the Q4 marketing campaign. The leadership team is asking for an update, and I wanted to get the latest from you before our meeting tomorrow.\n\nCould you send me a quick status update? Particularly interested in:\n- Creative asset progress\n- Media buy timeline\n- Any blockers we should be aware of\n\nThanks!\nSarah",
    description: 'Request for project status update'
  },
  {
    name: 'Meeting Request',
    from: 'michael.johnson@partner.com',
    to: ['me@company.com'],
    cc: ['team@company.com'],
    subject: 'Meeting to discuss partnership opportunities',
    body: "Hi,\n\nI hope this email finds you well. I'm reaching out because we've been exploring potential partnership opportunities that could benefit both our organizations.\n\nWould you be available for a 30-minute call next week to discuss this further? I'm particularly interested in exploring:\n\n1. Integration possibilities between our platforms\n2. Co-marketing opportunities\n3. Revenue sharing models\n\nI'm available Tuesday through Thursday between 2-5 PM EST. Please let me know what works best for you.\n\nBest regards,\nMichael Johnson\nVP of Partnerships",
    description: 'External partnership meeting request'
  },
  {
    name: 'Urgent Request',
    from: 'alex.kumar@company.com',
    to: ['me@company.com'],
    subject: 'URGENT: Server issues affecting production',
    body: "Hi,\n\nWe're experiencing critical issues with the production servers. The main application has been down for the past 15 minutes.\n\nError logs show database connection timeouts. The ops team is investigating but we need your input on the recent deployment.\n\nCan you join the incident call immediately? Link: meet.company.com/incident-response\n\nAlex",
    description: 'Urgent technical issue requiring immediate attention'
  },
  {
    name: 'Customer Feedback',
    from: 'support@customer.com',
    to: ['me@company.com'],
    subject: 'Feedback on your product',
    body: "Hello,\n\nWe've been using your product for the past 3 months and wanted to share some feedback.\n\nPositives:\n- Great user interface\n- Excellent customer support\n- Feature set meets our needs\n\nAreas for improvement:\n- Mobile app could be more responsive\n- Would love to see more integration options\n- Reporting features need enhancement\n\nOverall, we're satisfied but looking forward to improvements in the mentioned areas.\n\nBest,\nCustomer Success Team",
    description: 'Customer feedback email'
  },
  {
    name: 'Thread Reply',
    from: 'jennifer.lee@consulting.com',
    to: ['me@company.com'],
    subject: 'Re: Project Timeline Discussion',
    body: "Thanks for the quick response!\n\nI agree with your assessment. Let's proceed with the revised timeline.\n\nJust to confirm:\n- Phase 1 completion: End of this month\n- Phase 2 start: First week of next month\n- Final delivery: 6 weeks from Phase 2 start\n\nCould you send over the updated project plan by EOD tomorrow?\n\nJennifer",
    description: 'Reply in an ongoing thread'
  }
];

type InjectionHarnessSuccess = {
  success: true;
  filtered: boolean;
  message: string;
  injectedEmail: {
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    date: string;
    messageId: string;
    rfc2822MessageId: string;
    labelIds: string[];
    threadId: string | null;
    simulateReply: boolean;
    parentMessageId: string | null;
  };
  filterResult: {
    shouldReply: boolean;
    reason: string;
    category: 'allowed' | 'blocked' | 'filtered';
  };
  generatedReply:
    | null
    | {
        reply: string;
        confidence: number;
        reasoning: string;
        ccRecipients?: string[];
        contextualInfo?: {
          calendarUsed: boolean;
          emailsAnalyzed: number;
          suggestedActions: string[];
          contextConfidence: number;
          emailSummary?: string;
          plannerPlan?: unknown;
        };
      };
  timingsMs: { total: number; filter: number; reply?: number };
};

export const EmailSimulatorPage: React.FC = () => {
  const { data: session } = useSession();
  const userEmail = session?.user?.email || 'me@company.com';
  
  const [inputMode, setInputMode] = useState<'form' | 'json'>('form');
  const [formData, setFormData] = useState({
    from: '',
    subject: '',
    body: '',
    messageId: '',
    threadId: '',
    date: new Date().toISOString().slice(0, 16),
    simulateReply: false,
    parentMessageId: ''
  });

  const [jsonInput, setJsonInput] = useState('');
  const [toInput, setToInput] = useState(userEmail);
  const [ccInput, setCcInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<InjectionHarnessSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  // Sync JSON input with form data when switching to JSON mode
  useEffect(() => {
    if (inputMode === 'json' && !jsonInput) {
      const to = toInput
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean);
      const cc = ccInput
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean);
      const labelIds = labelInput
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);

      const payload = {
        from: formData.from || 'sender@example.com',
        to: to.length > 0 ? to : [userEmail],
        cc: cc.length > 0 ? cc : undefined,
        subject: formData.subject || 'Test Subject',
        body: formData.body || 'Test Body content...',
        labelIds: labelIds.length > 0 ? labelIds : undefined,
        date: formData.date || undefined,
        messageId: formData.messageId || undefined,
        threadId: formData.threadId || undefined,
        simulateReply: formData.simulateReply || undefined,
        parentMessageId: formData.parentMessageId || undefined,
      };
      setJsonInput(JSON.stringify(payload, null, 2));
    }
  }, [
    inputMode,
    jsonInput,
    toInput,
    ccInput,
    labelInput,
    formData.body,
    formData.date,
    formData.from,
    formData.messageId,
    formData.parentMessageId,
    formData.simulateReply,
    formData.subject,
    formData.threadId,
    userEmail,
  ]);

  const handleTemplateChange = (templateName: string) => {
    setSelectedTemplate(templateName);
    const template = emailTemplates.find((t) => t.name === templateName);
    if (!template) return;

    setFormData((prev) => ({
      ...prev,
      from: template.from,
      subject: template.subject,
      body: template.body,
    }));
    setToInput(template.to.join(', '));
    setCcInput((template.cc || []).join(', '));
    
    if (inputMode === 'json') {
      const payload = {
        from: template.from,
        to: template.to,
        cc: template.cc,
        subject: template.subject,
        body: template.body,
      };
      setJsonInput(JSON.stringify(payload, null, 2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);
    setError(null);

    try {
      let payload: any;

      if (inputMode === 'json') {
        try {
          payload = JSON.parse(jsonInput);
        } catch (e) {
          setError('Invalid JSON format. Please check your syntax.');
          setIsLoading(false);
          return;
        }
      } else {
        const to = toInput
          .split(',')
          .map((email) => email.trim())
          .filter(Boolean);
        const cc = ccInput
          ? ccInput
              .split(',')
              .map((email) => email.trim())
              .filter(Boolean)
          : [];
        const labelIds = labelInput
          ? labelInput
              .split(',')
              .map((label) => label.trim())
              .filter(Boolean)
          : [];

        const optional = (value: string) => (value.trim().length > 0 ? value.trim() : undefined);

        payload = {
          from: formData.from,
          to,
          cc,
          subject: formData.subject,
          body: formData.body,
          labelIds,
          date: optional(formData.date),
          messageId: optional(formData.messageId),
          threadId: optional(formData.threadId),
          simulateReply: formData.simulateReply,
          parentMessageId: optional(formData.parentMessageId),
        };
      }

      const response = await fetch('/api/test-simulate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setResult(data as InjectionHarnessSuccess);
      } else {
        // Build a user-friendly error message
        let errorMessage = data.error || 'Failed to inject email';
        
        if (data.issues && Array.isArray(data.issues)) {
          // Parse Zod validation issues into readable format
          const issueDetails = data.issues.map((issue: { path: string[]; message: string }) => {
            const field = issue.path?.join('.') || 'unknown';
            return `• ${field}: ${issue.message}`;
          }).join('\n');
          
          errorMessage = `Validation failed:\n${issueDetails}`;
          
          // Use console.warn instead of console.error to avoid Next.js error interception
          console.warn('[EmailSimulator] Validation issues:', data.issues);
        }
        
        setError(errorMessage);
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setFormData({
      from: '',
      subject: '',
      body: '',
      messageId: '',
      threadId: '',
      date: new Date().toISOString().slice(0, 16),
      simulateReply: false,
      parentMessageId: ''
    });
    setJsonInput('');
    setToInput(userEmail);
    setCcInput('');
    setLabelInput('');
    setSelectedTemplate('');
    setResult(null);
    setError(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const schemaInfo = {
    required: {
      from: 'string (email)',
      to: 'string[] (array of emails)',
      subject: 'string',
      body: 'string'
    },
    optional: {
      cc: 'string[]',
      labelIds: 'string[] (e.g. ["INBOX", "UNREAD"])',
      date: 'string (ISO format)',
      messageId: 'string',
      threadId: 'string (DB thread ID)',
      simulateReply: 'boolean',
      parentMessageId: 'string (DB message ID)'
    }
  };

  return (
    <div className="min-h-screen bg-black p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          <h1 className="text-2xl sm:text-3xl font-semibold text-white mb-2">
            Simulator
          </h1>
          <p className="text-gray-300 max-w-3xl">
            Pipeline testing tool.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
           {/* Input Section */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white flex items-center">
                {inputMode === 'form' ? <Layout className="mr-2" size={20} /> : <Code className="mr-2" size={20} />}
                {inputMode === 'form' ? 'Email Configuration' : 'Raw JSON Injection'}
              </h2>
              
              <div className="flex bg-gray-800 p-1 rounded-lg">
                <button
                  onClick={() => setInputMode('form')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    inputMode === 'form' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Form
                </button>
                <button
                  onClick={() => setInputMode('json')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    inputMode === 'json' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  JSON
                </button>
              </div>
            </div>

            {/* Template Selector */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Quick Templates
              </label>
              <select
                value={selectedTemplate}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a template...</option>
                {emailTemplates.map(template => (
                  <option key={template.name} value={template.name}>
                    {template.name} - {template.description}
                  </option>
                ))}
              </select>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col space-y-4">
              {inputMode === 'form' ? (
                /* Form Fields */
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      From <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.from}
                      onChange={(e) => setFormData({ ...formData, from: e.target.value })}
                      placeholder="sender@example.com"
                      className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      To <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={toInput}
                      onChange={(e) => setToInput(e.target.value)}
                      placeholder="recipient@example.com, another@example.com"
                      className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                    <p className="text-xs text-gray-400 mt-1">Comma-separated email addresses</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      CC
                    </label>
                    <input
                      type="text"
                      value={ccInput}
                      onChange={(e) => setCcInput(e.target.value)}
                      placeholder="cc@example.com, another@example.com"
                      className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Subject <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.subject}
                      onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                      placeholder="Email subject line"
                      className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Body <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={formData.body}
                      onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                      placeholder="Email body content..."
                      rows={6}
                      className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  {/* Advanced Options */}
                  <details className="border border-gray-700 rounded-xl p-4">
                    <summary className="cursor-pointer text-sm font-medium text-gray-300 flex items-center">
                      Advanced Options
                    </summary>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Message ID
                        </label>
                        <input
                          type="text"
                          value={formData.messageId}
                          onChange={(e) => setFormData({ ...formData, messageId: e.target.value })}
                          placeholder="Auto-generated if empty"
                          className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Thread ID
                        </label>
                        <input
                          type="text"
                          value={formData.threadId}
                          onChange={(e) => setFormData({ ...formData, threadId: e.target.value })}
                          placeholder="Database thread ID (optional)"
                          className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Date
                        </label>
                        <input
                          type="datetime-local"
                          value={formData.date}
                          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                          className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Label IDs
                        </label>
                        <input
                          type="text"
                          value={labelInput}
                          onChange={(e) => setLabelInput(e.target.value)}
                          placeholder="INBOX, UNREAD, IMPORTANT"
                          className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">Comma-separated Gmail labels</p>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={formData.simulateReply}
                            onChange={(e) => setFormData({ ...formData, simulateReply: e.target.checked })}
                            className="rounded bg-gray-800 border-gray-600 text-blue-500 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-300">Simulate Reply</span>
                        </label>

                        {formData.simulateReply && (
                          <div className="ml-6">
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                              Parent Message ID
                            </label>
                            <input
                              type="text"
                              value={formData.parentMessageId}
                              onChange={(e) => setFormData({ ...formData, parentMessageId: e.target.value })}
                              placeholder="ID of email being replied to"
                              className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </details>
                </div>
              ) : (
                /* JSON Input */
                <div className="flex-1 flex flex-col space-y-4 min-h-[400px]">
                  <div className="flex-1 flex flex-col">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      JSON Payload <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={jsonInput}
                      onChange={(e) => setJsonInput(e.target.value)}
                      placeholder='{ "from": "...", "to": ["..."], "subject": "...", "body": "..." }'
                      className="flex-1 w-full p-4 bg-gray-800 border border-gray-700 rounded-xl text-white font-mono text-xs focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                  
                  <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Expected Schema</h4>
                      <div className="grid grid-cols-2 gap-4 text-[10px] font-mono">
                      <div>
                        <p className="text-blue-400 mb-1">{'// Required'}</p>
                        {Object.entries(schemaInfo.required).map(([key, val]) => (
                          <p key={key} className="mb-0.5"><span className="text-gray-300">{key}:</span> <span className="text-gray-500">{val}</span></p>
                        ))}
                      </div>
                      <div>
                        <p className="text-purple-400 mb-1">{'// Optional'}</p>
                        {Object.entries(schemaInfo.optional).map(([key, val]) => (
                          <p key={key} className="mb-0.5"><span className="text-gray-300">{key}:</span> <span className="text-gray-500">{val}</span></p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex space-x-3 pt-4">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:text-gray-400 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={16} className="mr-2 animate-spin" />
                      Injecting...
                    </>
                  ) : (
                    <>
                      <Send size={16} className="mr-2" />
                      Inject Email
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl transition-colors flex items-center"
                >
                  <RefreshCw size={16} className="mr-2" />
                  Reset
                </button>
              </div>
            </form>
          </div>

          {/* Results Section */}
          <div className="space-y-6">
            {/* Status Messages */}
            {error && (
              <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 flex items-start space-x-3">
                <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
                <div className="flex-1">
                  <h3 className="text-red-400 font-medium">Error</h3>
                  <pre className="text-red-300 text-sm mt-1 whitespace-pre-wrap font-sans">{error}</pre>
                </div>
              </div>
            )}

            {result && (
              <div className={`border rounded-xl p-4 ${
                result.filtered 
                ? 'bg-amber-900/20 border-amber-800' 
                : 'bg-emerald-900/20 border-emerald-800'
              }`}>
                <div className="flex items-start space-x-3">
                  {result.filtered ? (
                    <Filter className="text-amber-400 flex-shrink-0 mt-0.5" size={20} />
                  ) : (
                    <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={20} />
                  )}
                  <div className="flex-1">
                    <h3 className={`font-medium ${
                      result.filtered ? 'text-amber-400' : 'text-emerald-400'
                    }`}>
                      {result.filtered ? 'Email Filtered' : 'Success'}
                    </h3>
                    <p className={`text-sm mt-1 ${
                      result.filtered ? 'text-amber-300' : 'text-emerald-300'
                    }`}>
                      {result.message}
                    </p>
                    {result.filtered && (
                      <div className="mt-2 text-sm">
                        <p className="text-amber-200">
                          <strong>Reason:</strong> {result.filterResult.reason}
                        </p>
                        <p className="text-amber-200">
                          <strong>Category:</strong> {result.filterResult.category}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Email Details */}
            {result && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                  <Mail className="mr-2" size={18} />
                  Injection Details
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-start">
                    <span className="text-gray-400">Message ID:</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-200 font-mono text-xs truncate max-w-[200px]">
                        {result.injectedEmail.messageId}
                      </span>
                      <button
                        onClick={() => copyToClipboard(result.injectedEmail.messageId)}
                        className="text-gray-400 hover:text-gray-200"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-400">RFC2822 Message ID:</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-200 font-mono text-xs truncate max-w-[200px]">
                        {result.injectedEmail.rfc2822MessageId}
                      </span>
                      <button
                        onClick={() => copyToClipboard(result.injectedEmail.rfc2822MessageId)}
                        className="text-gray-400 hover:text-gray-200"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Thread ID:</span>
                    <span className="text-gray-200 font-mono text-xs">{result.injectedEmail.threadId || 'None'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Date:</span>
                    <span className="text-gray-200 text-xs">
                      {new Date(result.injectedEmail.date).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Filter:</span>
                    <span className="text-gray-200 text-xs">{result.filterResult.reason}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Timings:</span>
                    <span className="text-gray-200 text-xs">
                      total {result.timingsMs.total}ms · filter {result.timingsMs.filter}ms
                      {typeof result.timingsMs.reply === 'number' ? ` · reply ${result.timingsMs.reply}ms` : ''}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Generated Reply */}
            {result && result.generatedReply && (() => {
              const { generatedReply } = result;

              return (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                    <MessageSquare className="mr-2" size={18} />
                    Generated Reply
                  </h3>
                  
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm text-gray-400">
                      Confidence:{' '}
                      <span className="text-emerald-400 font-medium">{generatedReply.confidence}%</span>
                    </span>
                    {generatedReply.ccRecipients && generatedReply.ccRecipients.length > 0 && (
                      <span className="text-sm text-gray-400">
                        CC: <span className="text-gray-200">{generatedReply.ccRecipients.join(', ')}</span>
                      </span>
                    )}
                  </div>

                  <div className="bg-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-gray-400">Reply Text</span>
                      <button
                        onClick={() => copyToClipboard(generatedReply.reply)}
                        className="text-gray-400 hover:text-gray-200"
                        title="Copy reply"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap text-xs text-gray-200 font-mono leading-relaxed">
                      {generatedReply.reply}
                    </pre>
                    <p className="text-xs text-gray-400 mt-3">
                      No DB/Gmail persistence — copy the reply text for inspection.
                    </p>
                  </div>

                  {generatedReply.contextualInfo && (
                    <div className="mt-4 text-sm text-gray-400">
                      <p>
                        Context used: {generatedReply.contextualInfo.calendarUsed ? '📅 Calendar' : ''}{' '}
                        {generatedReply.contextualInfo.emailsAnalyzed > 0 &&
                          `📧 ${generatedReply.contextualInfo.emailsAnalyzed} emails`}
                      </p>
                      {generatedReply.contextualInfo.suggestedActions.length > 0 && (
                        <p className="mt-1">
                          Suggested actions: {generatedReply.contextualInfo.suggestedActions.join(', ')}
                        </p>
                      )}

                      {!!generatedReply.contextualInfo.plannerPlan && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-gray-300">
                            Planner Plan (debug)
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-200 font-mono leading-relaxed bg-gray-800 rounded-lg p-3 border border-gray-700">
                            {JSON.stringify(generatedReply.contextualInfo.plannerPlan, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Next Steps */}
            {result && !result.filtered && (
              <div className="bg-blue-900/20 border border-blue-800 rounded-xl p-4">
                <h4 className="text-blue-400 font-medium mb-2">Next Steps</h4>
                <p className="text-blue-300 text-sm">
                  This harness does not create DB records or Gmail drafts. Use it for fast iteration, prompt tuning, and regression runs.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
