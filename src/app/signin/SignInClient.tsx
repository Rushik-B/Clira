"use client"

import { signIn } from "next-auth/react"
import { useState } from "react"
import { SparklesCore } from "@/components/ui/sparkles"
import { Button } from "@/components/ui/sidebar/button"
import { GoogleColor as GoogleIcon } from "@/components/icons/icons"
import { motion } from "motion/react"

export default function SignInClient() {
  const [isSigningIn, setIsSigningIn] = useState(false)

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

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center">
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
          className="
            -mt-24 mb-12
            text-center
            text-5xl sm:text-6xl md:text-7xl
            font-black tracking-tight leading-[0.95]
            text-transparent bg-clip-text
            bg-gradient-to-r from-white/90 via-blue-100/90 to-blue-200/80
            drop-shadow-[0_0_14px_rgba(59,130,246,0.18)]
          "
        >
          Welcome to Clira
        </motion.h1>

        <div className="flex items-center justify-center p-6">
          <div className="relative group">
            <div className="pointer-events-none absolute -inset-5 rounded-3xl bg-white/12 blur-2xl opacity-70 group-hover:opacity-90 transition-opacity duration-300" />
            <Button
              type="button"
              onClick={async () => {
                if (isSigningIn) return
                setIsSigningIn(true)
                try {
                  await signIn("google")
                } finally {
                  // In most cases the page will redirect; this is a safety fallback.
                  setIsSigningIn(false)
                }
              }}
              disabled={isSigningIn}
              size="lg"
              className="relative group h-14 rounded-2xl bg-white px-10 text-black hover:bg-white/90 border border-white/10 shadow-lg shadow-white/25 hover:shadow-white/40 text-lg cursor-pointer transition-all duration-300"
              aria-label="Login with Google"
              aria-busy={isSigningIn}
            >
              <GoogleIcon className="size-6" />
              <span className="font-semibold">
                {isSigningIn ? "Redirecting…" : "Login with Google"}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}


