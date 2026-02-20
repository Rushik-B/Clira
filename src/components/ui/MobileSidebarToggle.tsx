"use client"

import React from "react"
import { useSidebar } from "@/components/ui/sidebar/sidebar"
import { PanelLeftOpen, X } from "@/components/icons/icons"

export const MobileSidebarToggle: React.FC = () => {
  const { isMobile, openMobile, toggleSidebar } = useSidebar()

  // Render only on mobile to avoid impacting desktop/wide
  if (!isMobile) return null

  return (
    <button
      type="button"
      aria-label={openMobile ? "Close menu" : "Open menu"}
      onClick={toggleSidebar}
      // Fixed, mobile-only. High z-index to sit above content and overlay.
      className={
        `md:hidden fixed top-4 ${openMobile ? "right-4" : "left-4"} z-[60] ` +
        // Visuals: subtle glass, clean border, elegant hover/active
        "h-11 w-11 rounded-full flex items-center justify-center " +
        "bg-gray-800/85 border border-gray-700/70 text-gray-100 shadow-xl backdrop-blur-sm " +
        "transition-all duration-150 ease-out active:scale-[0.98] hover:bg-gray-800/95 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      }
    >
      {openMobile ? (
        <X className="size-4" />
      ) : (
        <PanelLeftOpen className="size-4" />
      )}
    </button>
  )
}

