'use client';

import React from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WHATSAPP_CTA_URL } from '@/lib/publicConfig';
import { PrimaryButton, LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { SparklesCore } from '@/components/ui/sparkles';

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className={className}>
    <path
      fill="currentColor"
      d="M4.868,43.303l2.694-9.835C5.9,30.59,5.026,27.324,5.027,23.979C5.032,13.514,13.548,5,24.014,5c5.079,0.002,9.845,1.979,13.43,5.566c3.584,3.588,5.558,8.356,5.556,13.428c-0.004,10.465-8.522,18.98-18.986,18.98c-0.001,0,0,0,0,0h-0.008c-3.177-0.001-6.3-0.798-9.073-2.311L4.868,43.303z"
    />
    <path
      fill="#40c351"
      d="M35.176,12.832c-2.98-2.982-6.941-4.625-11.157-4.626c-8.704,0-15.783,7.076-15.787,15.774c-0.001,2.981,0.833,5.883,2.413,8.396l0.376,0.597l-1.595,5.821l5.973-1.566l0.577,0.342c2.422,1.438,5.2,2.198,8.032,2.199h0.006c8.698,0,15.777-7.077,15.78-15.776C39.795,19.778,38.156,15.814,35.176,12.832z"
    />
    <path
      fill="#fff"
      fillRule="evenodd"
      d="M19.268,16.045c-0.355-0.79-0.729-0.806-1.068-0.82c-0.277-0.012-0.593-0.011-0.909-0.011c-0.316,0-0.83,0.119-1.265,0.594c-0.435,0.475-1.661,1.622-1.661,3.956c0,2.334,1.7,4.59,1.937,4.906c0.237,0.316,3.282,5.259,8.104,7.161c4.007,1.58,4.823,1.266,5.693,1.187c0.87-0.079,2.807-1.147,3.202-2.255c0.395-1.108,0.395-2.057,0.277-2.255c-0.119-0.198-0.435-0.316-0.909-0.554s-2.807-1.385-3.242-1.543c-0.435-0.158-0.751-0.237-1.068,0.238c-0.316,0.474-1.225,1.543-1.502,1.859c-0.277,0.317-0.554,0.357-1.028,0.119c-0.474-0.238-2.002-0.738-3.815-2.354c-1.41-1.257-2.362-2.81-2.639-3.285c-0.277-0.474-0.03-0.731,0.208-0.968c0.213-0.213,0.474-0.554,0.712-0.831c0.237-0.277,0.316-0.475,0.474-0.791c0.158-0.317,0.079-0.594-0.04-0.831C20.612,19.329,19.69,16.983,19.268,16.045z"
      clipRule="evenodd"
    />
  </svg>
);

export interface WhatsAppPromoCardProps {
  onDismiss: () => void;
  onConnect: () => void;
}

export const WhatsAppPromoCard: React.FC<WhatsAppPromoCardProps> = ({
  onDismiss,
  onConnect,
}) => {
  const hasWhatsAppCta = WHATSAPP_CTA_URL.trim().length > 0;

  const handleConnect = () => {
    if (hasWhatsAppCta) {
      window.open(WHATSAPP_CTA_URL, '_blank', 'noopener,noreferrer');
    }
    onConnect();
  };

  return (
    <article
      className={cn(
        'relative flex flex-col gap-6 rounded-[28px] overflow-hidden',
        'border border-white/8 bg-gradient-to-b from-white/4 via-white/[0.03] to-black/20',
        'p-4 shadow-[0_20px_60px_-32px_rgba(37,211,102,0.4)]',
        'transition-all duration-300 ease-out backdrop-blur-xl',
        'sm:p-6 md:min-h-[420px] md:grid md:grid-cols-[minmax(0,520px)_1fr] md:items-center md:gap-8 md:p-8'
      )}
    >
      {/* Sparkles background effect */}
      <div className="absolute inset-0 pointer-events-none">
        <SparklesCore
          id="whatsapp-promo-sparkles"
          background="transparent"
          minSize={0.4}
          maxSize={1.2}
          particleDensity={40}
          particleColor="#25D366"
          speed={1.5}
          className="w-full h-full"
        />
      </div>

      {/* Ambient glow effects */}
      <div className="absolute -inset-4 rounded-3xl blur-3xl bg-gradient-radial from-emerald-500/10 via-green-600/5 to-transparent opacity-60 pointer-events-none" />
      <div className="absolute top-0 right-0 w-1/2 h-1/2 blur-3xl bg-gradient-radial from-green-400/8 to-transparent opacity-50 pointer-events-none" />

      {/* Close button */}
      <button
        type="button"
        onClick={onDismiss}
        className={cn(
          'absolute top-4 right-4 z-20',
          'flex h-8 w-8 items-center justify-center rounded-full',
          'border border-white/20 bg-black/60 text-slate-300',
          'transition-all duration-200 hover:scale-105 hover:bg-black/80 hover:text-white',
          'cursor-pointer'
        )}
        aria-label="Dismiss promotion"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Image section */}
      <div className="relative flex w-full justify-center md:justify-start z-10">
        <div
          className={cn(
            'relative aspect-[4/3] w-full max-w-[480px] overflow-hidden rounded-2xl',
            'border border-white/10 bg-black/40 shadow-inner'
          )}
        >
          <Image
            src="/Whatsapp-image/whatsapp-cta.png"
            alt="WhatsApp integration with Clira - message your AI assistant"
            fill
            priority
            className="object-cover"
          />
        </div>
      </div>

      {/* Content section */}
      <div className="relative flex h-full flex-col items-center justify-center space-y-5 text-center md:items-start md:text-left z-10">
        <div className="space-y-3">
          <h2 className="text-2xl font-extrabold text-white sm:text-3xl md:text-4xl">
            Initialize your Chief of Staff.
          </h2>
          <p className="text-sm text-slate-300 sm:text-base md:text-lg max-w-md">
            Real assistants don&apos;t sit in a browser tab—they live in your pocket. Connect WhatsApp to query your
            inbox, draft replies, and clear the noise just by texting.
          </p>
        </div>

        {/* CTA buttons */}
        <div className="flex w-full flex-col items-center gap-2 pt-2 md:items-start">
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <PrimaryButton
              onClick={handleConnect}
              minWidth="lg"
              className="bg-emerald-600 hover:bg-emerald-500 ring-emerald-400/30 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
              disabled={!hasWhatsAppCta}
            >
              <span className="flex items-center gap-2">
                <WhatsAppIcon className="h-4 w-4 text-white" />
                {hasWhatsAppCta ? 'Connect WhatsApp & Say Hi →' : 'WhatsApp link not configured'}
              </span>
            </PrimaryButton>
            <LiquidButton
              onClick={onDismiss}
              variant="default"
              size="lg"
              minWidth="sm"
              className={cn(LIQUID_BUTTON_BASE_CLASS, 'cursor-pointer')}
              type="button"
            >
              Maybe later
            </LiquidButton>
          </div>
          <p className="text-xs text-slate-400">
            Takes 10 seconds. No setup required.
          </p>
        </div>
      </div>
    </article>
  );
};
