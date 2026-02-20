'use client';

import React, { useState, useEffect } from 'react';
import { ExternalLink, AlertTriangle, Smartphone } from 'lucide-react';
import { SUPPORT_EMAIL } from '@/lib/publicConfig';

interface InAppBrowserDetectorProps {
  children: React.ReactNode;
}

export const InAppBrowserDetector: React.FC<InAppBrowserDetectorProps> = ({ children }) => {
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [browserName, setBrowserName] = useState('');

  useEffect(() => {
    const detectInAppBrowser = () => {
      const ua = navigator.userAgent || navigator.vendor || (window as any).opera || '';
      
      // Detect various in-app browsers
      const inAppPatterns = [
        { pattern: /instagram/i, name: 'Instagram' },
        { pattern: /fbav|fbios|fban/i, name: 'Facebook' },
        { pattern: /linkedin/i, name: 'LinkedIn' },
        { pattern: /line/i, name: 'Line' },
        { pattern: /twitter/i, name: 'Twitter' },
        { pattern: /snapchat/i, name: 'Snapchat' },
        { pattern: /webview/i, name: 'WebView' },
        { pattern: /wechat/i, name: 'WeChat' },
        { pattern: /micromessenger/i, name: 'WeChat' },
        { pattern: /tiktok/i, name: 'TikTok' },
        { pattern: /telegram/i, name: 'Telegram' },
        { pattern: /whatsapp/i, name: 'WhatsApp' },
        { pattern: /discord/i, name: 'Discord' },
        { pattern: /reddit/i, name: 'Reddit' },
        { pattern: /pinterest/i, name: 'Pinterest' },
      ];

      for (const { pattern, name } of inAppPatterns) {
        if (pattern.test(ua)) {
          setIsInAppBrowser(true);
          setBrowserName(name);
          return;
        }
      }

      setIsInAppBrowser(false);
    };

    detectInAppBrowser();
  }, []);

  if (!isInAppBrowser) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Warning Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
          {/* Icon */}
          <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <AlertTriangle className="w-8 h-8 text-white" />
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Browser Not Supported
          </h1>

          {/* Description */}
          <p className="text-gray-600 leading-relaxed mb-6">
            Google Sign-In doesn't work in {browserName}'s built-in browser for security reasons. 
            This affects all websites, not just ours.
          </p>

          {/* Instructions */}
          <div className="bg-blue-50 rounded-xl p-6 mb-6 text-left">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
              <Smartphone className="w-5 h-5 mr-2 text-blue-600" />
              How to fix this:
            </h3>
            <ol className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start">
                <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mr-3 mt-0.5 flex-shrink-0">1</span>
                <span>Tap the <strong>"⋯"</strong> or <strong>"Share"</strong> button (usually in the top or bottom corner)</span>
              </li>
              <li className="flex items-start">
                <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mr-3 mt-0.5 flex-shrink-0">2</span>
                <span>Select <strong>"Open in Safari"</strong> or <strong>"Open in Chrome"</strong></span>
              </li>
              <li className="flex items-start">
                <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mr-3 mt-0.5 flex-shrink-0">3</span>
                <span>Sign in with Google will work perfectly!</span>
              </li>
            </ol>
          </div>

          {/* Alternative Action */}
          <div className="space-y-3">
            <button
              onClick={() => {
                // Try to open in default browser (works on some platforms)
                const currentUrl = window.location.href;
                window.open(currentUrl, '_system');
              }}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-6 rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-lg hover:shadow-xl flex items-center justify-center"
            >
              <ExternalLink className="w-5 h-5 mr-2" />
              Try Opening in Browser
            </button>
            
            <p className="text-xs text-gray-500">
              If the button above doesn't work, please use the menu option described above
            </p>
          </div>

          {/* Footer Note */}
          <div className="mt-8 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              This is a security feature by Google that affects all websites. 
              Major apps like Slack, Notion, and Discord show similar messages.
            </p>
          </div>
        </div>

        {/* Additional Help */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Need help? Contact us at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}; 
