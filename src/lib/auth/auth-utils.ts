import { signOut as nextAuthSignOut } from "next-auth/react"

// URL of the landing page (defaults to localhost for development)
const LANDING_PAGE_URL = process.env.NEXT_PUBLIC_LANDING_PAGE_URL || 'http://localhost:8080'

export async function signOutAndRedirect() {
  console.log('🔄 Signing out and redirecting to:', LANDING_PAGE_URL)
  
  try {
    // Sign out from NextAuth with callback URL
    await nextAuthSignOut({ 
      callbackUrl: LANDING_PAGE_URL,
      redirect: false // We'll handle redirect manually for better control
    })
    
    // Manual redirect to ensure it works
    window.location.href = LANDING_PAGE_URL
  } catch (error) {
    console.error('❌ Error during signout:', error)
    // Fallback: direct redirect even if signout fails
    window.location.href = LANDING_PAGE_URL
  }
} 