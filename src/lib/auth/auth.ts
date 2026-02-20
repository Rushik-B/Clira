import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { prisma } from "../prisma"
import { getDefaultMasterPrompt } from "../prompts"
import { GmailPushService } from "../email/gmailPushService"
import { encryptToken } from '@/lib/encryption'
import { DEFAULT_CALENDAR_TIMEZONE } from '@/constants/time'
import { checkUserScopes } from '@/lib/auth/scope-utils'

const isProduction = process.env.NODE_ENV === 'production'

export const authOptions: NextAuthOptions = {
  // Explicitly set these so cookie/crypto behavior is stable across proxies/dynos.
  // In production, OAuth requires consistent secure-cookie behavior; otherwise the
  // state cookie can be written under one name and read under another (→ "missing").
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: isProduction,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.labels https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.readonly",
          access_type: "offline",
          prompt: "consent"
        }
      }
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        try {
          // Create or update user in database
          const dbUser = await prisma.user.upsert({
            where: { email: user.email! },
            update: {
              name: user.name,
              updatedAt: new Date()
            },
            create: {
              email: user.email!,
              name: user.name,
            },
            include: { settings: true }
          })

          // Create default user settings if they don't exist
          if (!dbUser.settings) {
            await prisma.userSettings.create({
              data: {
                userId: dbUser.id,
                autonomyLevel: 0,
                replyScope: 'ALL_SENDERS',
                enablePushNotifications: true,
                preferencesSaved: true,
                // Calendar preferences default to PST until user updates in settings
                calendarTimezone: DEFAULT_CALENDAR_TIMEZONE,
                calendarContextCalendarIds: [],
              }
            })
          }

          // Create default master prompt if user doesn't have one
          await createDefaultMasterPromptForUser(dbUser.id);

          const providerAccountId = account.providerAccountId
          if (!providerAccountId) {
            throw new Error('Missing Google providerAccountId during sign-in')
          }

          const normalizedEmail = user.email?.toLowerCase()
          if (!normalizedEmail) {
            throw new Error('Missing Google email during sign-in')
          }

          const grantedScopes = (account.scope ?? '').split(' ').filter(Boolean)
          const scopeCheck = grantedScopes.length > 0 ? checkUserScopes(grantedScopes) : null
          if (!scopeCheck) {
            console.warn('⚠️ OAuth scope not provided by Google; assuming required scopes are present')
          }
          const hasRequiredScopes = scopeCheck
            ? scopeCheck.hasAllRequiredScopes && scopeCheck.hasGmailModify
            : true
          const hasAccessToken = Boolean(account.access_token)
          const mailboxStatus = hasAccessToken && hasRequiredScopes ? 'CONNECTED' : 'NEEDS_RECONNECT'

          const existingMailbox = await prisma.mailbox.findUnique({
            where: {
              userId_provider_providerAccountId: {
                userId: dbUser.id,
                provider: 'google',
                providerAccountId,
              },
            },
          })

          const mailboxCount = existingMailbox
            ? null
            : await prisma.mailbox.count({ where: { userId: dbUser.id } })

          const mailbox = existingMailbox
            ? await prisma.mailbox.update({
                where: { id: existingMailbox.id },
                data: {
                  emailAddress: normalizedEmail,
                  displayName: user.name ?? existingMailbox.displayName,
                  status: mailboxStatus,
                },
              })
            : await prisma.mailbox.create({
                data: {
                  userId: dbUser.id,
                  provider: 'google',
                  providerAccountId,
                  emailAddress: normalizedEmail,
                  displayName: user.name ?? null,
                  isPrimary: (mailboxCount ?? 0) === 0,
                  status: mailboxStatus,
                },
              })

          // Store or update OAuth account with encrypted tokens
          if (account.access_token) {
            await prisma.oAuthAccount.upsert({
              where: {
                provider_providerAccountId: {
                  provider: account.provider,
                  providerAccountId,
                }
              },
              update: {
                mailboxId: mailbox.id,
                accessToken: encryptToken(account.access_token),
                refreshToken: account.refresh_token ? encryptToken(account.refresh_token) : undefined,
                scope: account.scope,
                tokenType: account.token_type,
                expiresAt: account.expires_at,
              },
              create: {
                userId: dbUser.id,
                mailboxId: mailbox.id,
                provider: account.provider,
                providerAccountId,
                accessToken: encryptToken(account.access_token),
                refreshToken: account.refresh_token ? encryptToken(account.refresh_token) : undefined,
                scope: account.scope,
                tokenType: account.token_type,
                expiresAt: account.expires_at,
              }
            })

            // Ensure Gmail push notifications (watch) are set up on sign-in
            if (mailboxStatus !== 'CONNECTED') {
              console.warn(`⚠️ Skipping Gmail watch setup for mailbox ${mailbox.id} (status=${mailboxStatus})`)
            } else {
              try {
                if (!process.env.GOOGLE_CLOUD_PROJECT_ID) {
                  console.warn("GOOGLE_CLOUD_PROJECT_ID is not set; skipping Gmail watch setup")
                } else {
                  const pushService = new GmailPushService(dbUser.id)
                  const topicName = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/clira-email-updates`
                  await pushService.setupPushNotifications({
                    userId: dbUser.id,
                    mailboxId: mailbox.id,
                    topicName,
                  })
                  console.log(`✅ Gmail watch initialized on sign-in for user ${dbUser.id}, mailbox ${mailbox.id}`)
                }
              } catch (e) {
                console.error("❌ Failed to setup Gmail watch on sign-in:", e)
              }
            }
          } else {
            console.warn(`⚠️ Missing Google access token for user ${dbUser.id}; mailbox ${mailbox.id} marked as NEEDS_RECONNECT`)
          }

          // Store user ID, email, and image in the user object for JWT
          user.id = dbUser.id
          user.email = dbUser.email
          user.image = user.image // Preserve the Google profile image
        } catch (error) {
          console.error("Error during sign in:", error)
          return false
        }
      }
      return true
    },
    async jwt({ token, account, user }) {
      if (user) {
        token.userId = user.id
        token.email = user.email || undefined
        token.picture = user.image || undefined
      }

      return token
    },
    async session({ session, token }) {
      if (token.userId) {
        session.userId = token.userId as string
        session.user = {
          ...session.user,
          email: token.email as string,
          image: token.picture as string || session.user?.image
        }
      }

      return session
    }
  },
  session: {
    strategy: "jwt"
  }
}

/**
 * Creates a default master prompt for a new user
 */
async function createDefaultMasterPromptForUser(userId: string): Promise<void> {
  try {
    // Check if user already has a master prompt
    const existingPrompt = await prisma.masterPrompt.findFirst({
      where: { userId }
    });

    if (!existingPrompt) {
      await prisma.masterPrompt.create({
        data: {
          userId,
          prompt: getDefaultMasterPrompt(),
          version: 1,
          isActive: true
        }
      });
      console.log(`Created default master prompt for user ${userId}`);
    }
  } catch (error) {
    console.error('Error creating default master prompt:', error);
  }
}
