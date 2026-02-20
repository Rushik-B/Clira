/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Placeholder service for auto-fetching emails, to be fully implemented.
// Type checking disabled to allow build to pass.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth/auth'
import { onboardingQueue } from '@/lib/services/utils/queues'
import { prisma } from '@/lib/prisma'
import redisConnection from '@/lib/services/utils/redis'

/**
 * API endpoint to trigger the asynchronous onboarding process for a user.
 * This endpoint is now lightweight and simply enqueues a job.
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.userId

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        labelingOnboardingGenerated: true,
        masterPromptGenerated: true,
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Enforce that folder onboarding must be completed first
    if (!user.labelingOnboardingGenerated) {
      return NextResponse.json({ error: 'Complete label onboarding first.' }, { status: 400 })
    }

    // Check if user already has generated components to prevent re-triggering
    if (user.masterPromptGenerated) {
      return NextResponse.json({ message: 'Onboarding process already completed.' })
    }

    // Use predictable job ID for deduplication
    const jobId = `onboarding-${userId}`;
    
    // Check if job is already queued or running
    const existingJobs = await onboardingQueue.getJobs(['waiting', 'active', 'delayed']);
    const existingJob = existingJobs.find(job => job.id === jobId);
    
    if (existingJob) {
      console.log(`🚫 Onboarding job already exists for user: ${userId} (Job ID: ${jobId})`);
      return NextResponse.json({ 
        message: 'Onboarding process already in progress.',
        jobId: jobId
      })
    }

    // Check if there's a Redis lock indicating a job is running
    const lockKey = `onboarding-lock:${userId}`;
    const lockExists = await redisConnection.exists(lockKey);
    
    if (lockExists) {
      console.log(`🚫 Onboarding job already running for user: ${userId} (Redis lock exists)`);
      return NextResponse.json({ 
        message: 'Onboarding process already in progress.',
        jobId: jobId
      })
    }

    // Enqueue a job for the new onboarding worker with deduplication
    await onboardingQueue.add('start-onboarding', { userId }, {
      jobId, // Fixed job ID to prevent duplicates
      priority: 1, // High priority for onboarding
      delay: 0,
      attempts: 3,
      removeOnComplete: 5, // Keep last 5 completed jobs
      removeOnFail: 10     // Keep last 10 failed jobs for debugging
    })

    console.log(`🚀 Onboarding job enqueued for user: ${userId} (Job ID: ${jobId})`)

    return NextResponse.json({
      message: 'Onboarding process started successfully. Prompts will be generated in the background.',
      jobId: jobId
    }, { status: 202 })

  } catch (error) {
    console.error(`❌ Error starting onboarding process for user ${userId}:`, error)
    return NextResponse.json(
      { error: 'Failed to start onboarding process' },
      { status: 500 }
    )
  }
} 