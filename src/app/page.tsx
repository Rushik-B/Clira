"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

import { CliraApp } from "@/components/CliraApp";

export const dynamic = "force-dynamic";

export default function Home() {
  const { data: session, status } = useSession();

  const landingPageUrl = process.env.NEXT_PUBLIC_LANDING_PAGE_URL;

  useEffect(() => {
    if (status === "unauthenticated") {
      window.location.href = landingPageUrl || "/signin";
    }
  }, [status, landingPageUrl]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-200 border-t-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Redirecting to landing page...</p>
        </div>
      </div>
    );
  }

  return <CliraApp />;
}
