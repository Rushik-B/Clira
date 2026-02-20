import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { EmailCategorizationService } from '@/lib/services/onboarding-services/emailCategorizationService';
import { EmailMappingService } from '@/lib/services/onboarding-services/emailMappingService';
import { EmailLearningService } from '@/lib/services/onboarding-services/emailLearningService';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');
    const jobType = url.searchParams.get('jobType'); // 'categorization' | 'mapping' | 'learning'

    if (!jobId || !jobType) {
      return NextResponse.json({ error: 'Job ID and type are required' }, { status: 400 });
    }

    let status;
    
    switch (jobType) {
      case 'categorization':
        const categorizationService = new EmailCategorizationService();
        status = await categorizationService.getJobStatus(jobId);
        break;
      
      case 'mapping':
        const mappingService = new EmailMappingService();
        status = await mappingService.getMappingJobStatus(jobId);
        break;
      
      case 'learning':
        const learningService = new EmailLearningService();
        status = await learningService.getLearningJobStatus(jobId);
        break;
      
      default:
        return NextResponse.json({ error: 'Invalid job type' }, { status: 400 });
    }

    console.log(`[JOB STATUS] Checked ${jobType} job ${jobId}: ${status.status}`);

    return NextResponse.json({
      success: true,
      jobId,
      jobType,
      ...status
    });

  } catch (error) {
    console.error('[JOB STATUS] Error checking job status:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to check job status',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}