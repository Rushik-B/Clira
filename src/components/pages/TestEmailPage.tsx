'use client';

//This is a test page for the email sending functionality
//It allows you to send a test email to the user
//It also allows you to test the reply generation functionality
//It is used to test the email sending and reply generation functionality
//It is not used in the production environment
//It is only used for testing purposes
//It is not used in the production environment

import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { MobileHeader } from '@/components/ui/MobileHeader';
import { GlowingEffect } from '@/components/ui/glowing-effect';

export const TestEmailPage: React.FC = () => {
  const [formData, setFormData] = useState({
    from: 'employee@starboard.ai',
    to: 'sara@starboard.ai',
    cc: '',
    subject: `Deployment update`,
    body: `Hi all,\n\nQuick update — the maintenance window with Globex went smoothly.\n\nAlex's team completed the deployment at 12:28 AM PST. Validation steps were finalized shortly after, and we received confirmation from the Globex EU team that data integrity checks are passing on their end. No anomalies reported post-push.\n\nThanks everyone for the coordination and late-night support.\n\nBest,\nSara`,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (response.ok) {
        setStatusMessage({ type: 'success', message: 'Test email sent successfully! It should appear in the queue shortly.' });
      } else {
        setStatusMessage({ type: 'error', message: `Error: ${result.error || 'Failed to send email.'}` });
      }
    } catch {
      setStatusMessage({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-black">
      <MobileHeader title="Send a Test Email" />
      <div className="flex-1 space-y-8 w-full max-w-none p-8 pt-24 sm:pt-8 relative z-10">
        {/* Header */}
        <PageHeader
          title="Send a Test Email"
          subtitle="Test the email sending and reply generation functionality in a controlled environment."
          icon={Send}
          iconColor="text-emerald-400"
        />

        {/* Form Section */}
        <div className="relative group">
          <div className="absolute -inset-2 bg-gradient-to-r from-emerald-500/10 via-emerald-400/15 to-emerald-500/10 rounded-2xl blur-lg opacity-60"></div>
          <div className="relative bg-gray-900 border-2 border-gray-800/60 rounded-2xl p-8 shadow-xl backdrop-blur-sm">
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
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="from" className="block text-sm font-medium text-gray-300 mb-2">From</label>
                  <input
                    type="email"
                    name="from"
                    id="from"
                    value={formData.from}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 bg-gray-800/60 border-2 border-gray-700/50 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="to" className="block text-sm font-medium text-gray-300 mb-2">To</label>
                  <input
                    type="email"
                    name="to"
                    id="to"
                    value={formData.to}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 bg-gray-800/60 border-2 border-gray-700/50 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="cc" className="block text-sm font-medium text-gray-300 mb-2">CC (comma-separated)</label>
                <input
                  type="text"
                  name="cc"
                  id="cc"
                  value={formData.cc}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-800/60 border-2 border-gray-700/50 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all"
                />
              </div>

              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-gray-300 mb-2">Subject</label>
                <input
                  type="text"
                  name="subject"
                  id="subject"
                  value={formData.subject}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 bg-gray-800/60 border-2 border-gray-700/50 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all"
                />
              </div>

              <div>
                <label htmlFor="body" className="block text-sm font-medium text-gray-300 mb-2">Body</label>
                <textarea
                  name="body"
                  id="body"
                  rows={10}
                  value={formData.body}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 bg-gray-800/60 border-2 border-gray-700/50 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all resize-none"
                />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-800/60">
                {statusMessage && (
                  <div className={`px-4 py-2 rounded-lg text-sm font-medium ${
                    statusMessage.type === 'success' 
                      ? 'bg-emerald-900/20 border border-emerald-800/40 text-emerald-300' 
                      : 'bg-red-900/20 border border-red-800/40 text-red-300'
                  }`}>
                    {statusMessage.message}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex items-center px-6 py-3 border-2 border-emerald-600 text-sm font-medium rounded-xl shadow-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 disabled:bg-emerald-800 disabled:border-emerald-800 transition-all duration-200"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Send Email
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}; 