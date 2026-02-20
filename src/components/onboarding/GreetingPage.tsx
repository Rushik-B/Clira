'use client';

import React, { useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { SparklesCore } from '@/components/ui/sparkles';
import { Button } from '@/components/ui/sidebar/button';

interface GreetingPageProps {
  onNext: () => void;
  userName?: string;
}

export const GreetingPage: React.FC<GreetingPageProps> = ({ 
  onNext, 
  userName 
}) => {
  const { data: session } = useSession();
  const [showContent, setShowContent] = useState(false);

  // Get first name from session or fallback to prop or default
  const fullName = session?.user?.name || userName || "there";
  const firstName = fullName.split(' ')[0];

  useEffect(() => {
    // Trigger fade-in animation on mount without setTimeout
    setShowContent(true);
  }, []);

  return (
    <div className="relative min-h-screen w-full bg-black overflow-hidden">
      <SparklesCore
        className="absolute inset-0"
        background="transparent"
        particleColor="#ffffff"
        minSize={0.6}
        maxSize={1.8}
        speed={1.8}
        particleDensity={60}
      />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-6">
        <div
          className={`transition-opacity duration-1000 ease-out ${
            showContent ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <h1 className="mb-3 text-6xl sm:text-7xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white/90 via-blue-100/90 to-blue-200/80 drop-shadow-[0_0_14px_rgba(59,130,246,0.18)]">
            Hi {firstName}
          </h1>
          <p className="text-white/90 text-2xl sm:text-3xl font-semibold">
            Welcome to clira
          </p>
        </div>

        <div
          className={`mt-12 transition-opacity duration-1000 delay-300 ease-out ${
            showContent ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Button
            type="button"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              onNext();
            }}
            size="lg"
            className="relative group h-14 rounded-2xl bg-white px-10 text-black hover:bg-white/90 border border-white/10 shadow-lg shadow-white/25 hover:shadow-white/40 text-lg cursor-pointer transition-all duration-300"
            aria-label="Continue"
          >
            <span className="font-semibold">Continue</span>
            <ArrowRight className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
