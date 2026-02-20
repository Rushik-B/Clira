import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth/auth"
import { prisma } from "@/lib/prisma"
import SignInClient from "./SignInClient"

// Ensure this page always executes on the server and is not statically cached
export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function SignIn() {
  const session = await getServerSession(authOptions)

  // If authenticated, decide destination based on onboarding status server-side
  if (session?.userId) {
    let user: { labelingOnboardingGenerated: boolean; settings: { newOnboardingCompleted: boolean } | null } | null = null
    try {
      user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          labelingOnboardingGenerated: true,
          settings: {
            select: { newOnboardingCompleted: true }
          }
        }
      })
    } catch (err) {
      // Swallow DB lookup errors; we'll fall back to onboarding below
      console.error('Signin gate lookup failed:', err)
    }

    if (user?.labelingOnboardingGenerated === true || user?.settings?.newOnboardingCompleted) {
      redirect("/")
    }
    redirect("/onboarding-test-flow")
  }

  // Not authenticated → render the client sign-in UI
  return <SignInClient />
}
