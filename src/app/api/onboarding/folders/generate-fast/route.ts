import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { FastOnboardingService } from '@/lib/services/onboarding-services/fastOnboardingService';

export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new FastOnboardingService();
    const result = await service.queueProposalJob(session.userId, {
      maxEmails: 400,
    });

    if (result.cached) {
      return NextResponse.json({
        success: true,
        cached: true,
        data: {
          proposal: result.payload.proposal,
          autoSortingEnabled: result.payload.autoSortingEnabled,
          generatedAt: result.payload.generatedAt,
        },
      });
    }

    return NextResponse.json({
      success: true,
      cached: false,
      status: 'queued',
      jobId: result.jobId,
    });
  } catch (error) {
    console.error('[FAST ONBOARDING] Failed to generate proposal:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to generate folder suggestions',
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new FastOnboardingService();
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');

    const cached = await service.getProposalResult(session.userId);
    if (cached) {
      return NextResponse.json({
        success: true,
        ready: true,
        data: {
          proposal: cached.proposal,
          autoSortingEnabled: cached.autoSortingEnabled,
          generatedAt: cached.generatedAt,
        },
        status: {
          status: 'completed',
          progress: 100,
        },
      });
    }

    if (!jobId) {
      return NextResponse.json({
        success: true,
        ready: false,
        status: { status: 'waiting' },
      });
    }

    const status = await service.getJobStatus(jobId);

    if (status.status === 'failed') {
      return NextResponse.json({
        success: false,
        ready: false,
        status,
      }, { status: 500 });
    }

    if (status.status === 'completed') {
      const payload = await service.getProposalResult(session.userId);
      if (payload) {
        return NextResponse.json({
          success: true,
          ready: true,
          data: {
            proposal: payload.proposal,
            autoSortingEnabled: payload.autoSortingEnabled,
            generatedAt: payload.generatedAt,
          },
          status,
        });
      }

      return NextResponse.json({
        success: false,
        ready: false,
        status: { ...status, error: 'Result not yet available' },
      }, { status: 202 });
    }

    return NextResponse.json({
      success: true,
      ready: false,
      status,
    });
  } catch (error) {
    console.error('[FAST ONBOARDING] Failed to fetch proposal status:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch folder suggestions',
    }, { status: 500 });
  }
}
