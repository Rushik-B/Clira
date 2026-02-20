import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's email and thread counts
    const emailCount = await prisma.email.count({
      where: {
        thread: {
          userId: session.userId
        }
      }
    })

    const threadCount = await prisma.thread.count({
      where: {
        userId: session.userId
      }
    })

    return NextResponse.json({
      emailCount,
      threadCount
    })

  } catch (error) {
    console.error('Error fetching email stats:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch email stats',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
} 