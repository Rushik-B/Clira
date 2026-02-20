import React from 'react';
import Link from 'next/link';
import { SUPPORT_EMAIL } from '@/lib/publicConfig';

interface FooterProps {
  variant?: 'light' | 'dark';
  className?: string;
}

export const Footer: React.FC<FooterProps> = ({ variant = 'light', className = '' }) => {
  const isDark = variant === 'dark';
  
  return (
    <footer className={`border-t ${isDark ? 'border-white/10 bg-black/20 backdrop-blur-sm' : 'border-gray-200 bg-white'} ${className}`}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5">
              <img src="/logo.png" alt="Clira Logo" width={20} height={20} />
            </div>
            <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Clira</span>
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>© 2025</span>
          </div>
          
          <div className="flex items-center space-x-6 text-sm">
            <Link 
              href="/privacy" 
              className={`${isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors duration-200 cursor-pointer`}
            >
              Privacy Policy
            </Link>
            <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>•</span>
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Terms of Service</span>
            <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>•</span>
            <a 
              href={`mailto:${SUPPORT_EMAIL}`}
              className={`${isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} transition-colors duration-200 cursor-pointer`}
            >
              Support
            </a>
          </div>
        </div>
        
        <div className={`mt-6 pt-6 border-t ${isDark ? 'border-white/10' : 'border-gray-200'} text-center`}>
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'} leading-relaxed`}>
            By using Clira, you agree to our{' '}
            <Link href="/privacy" className={`${isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} transition-colors cursor-pointer`}>
              Privacy Policy
            </Link>
            {' '}and Terms of Service. Your data is encrypted and secure.
          </p>
        </div>
      </div>
    </footer>
  );
}; 
