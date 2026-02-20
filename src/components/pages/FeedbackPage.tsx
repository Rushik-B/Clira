import React from 'react';
import { MobileHeader } from '@/components/ui/MobileHeader';
import { Mail, Phone, MessageCircle } from 'lucide-react';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from '@/lib/publicConfig';

export const FeedbackPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <MobileHeader title="Feedback" />
      <div className="max-w-2xl mx-auto p-6 pt-24 sm:pt-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Feedback
            </h1>
            <p className="text-gray-600 dark:text-gray-300">
              I'd love to hear your thoughts on Clira
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center mr-4">
                <Mail className="w-5 h-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Email</h3>
                <a 
                  href={`mailto:${SUPPORT_EMAIL}`} 
                  className="text-blue-600 dark:text-blue-300 hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>
              </div>
            </div>

            {SUPPORT_PHONE && (
              <div className="flex items-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900 rounded-lg flex items-center justify-center mr-4">
                  <Phone className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Phone</h3>
                  <a
                    href={`tel:${SUPPORT_PHONE}`}
                    className="text-emerald-600 dark:text-emerald-300 hover:underline"
                  >
                    {SUPPORT_PHONE}
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="mt-8 p-4 bg-purple-50 dark:bg-purple-900/30 rounded-lg border border-purple-200 dark:border-purple-700">
            <div className="flex items-center mb-2">
              <MessageCircle className="w-5 h-5 text-purple-600 dark:text-purple-300 mr-2" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Your thoughts matter</h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 text-sm">
              Bug reports, feature requests, or just want to chat - I'd love to hear from you!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}; 
