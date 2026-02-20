import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { LLMService } from '@/lib/ml/llm';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { labelName, userDraft, examples } = body;

    if (!labelName || !userDraft) {
      return NextResponse.json({ 
        error: 'labelName and userDraft are required' 
      }, { status: 400 });
    }

    if (!Array.isArray(examples)) {
      return NextResponse.json({ 
        error: 'examples must be an array' 
      }, { status: 400 });
    }

    const llmService = new LLMService();

    // Build the prompt for LLM refinement
    const systemPrompt = `You are an AI assistant helping users create precise email sorting rules. Your task is to rewrite a user's draft rule so that an email-routing system can unambiguously decide if a message belongs to a specific folder.

Guidelines:
- Create clear, specific rules with bullet points
- Include positive and negative examples based on the provided email samples
- Focus on sender patterns, subject keywords, and content characteristics
- Be precise enough to avoid misclassification
- Keep the language simple and actionable

Return only the refined prompt text, no additional formatting or explanation.`;

    const userPrompt = `Folder: ${labelName}

User's draft rule: "${userDraft}"

Sample emails that should match this rule:
${examples.map((ex: any, i: number) => 
  `${i + 1}. From: ${ex.from} | Subject: "${ex.subject}" | Snippet: "${ex.snippet}"`
).join('\n')}

Please rewrite the user's rule to be more precise and actionable for email routing, including specific examples based on the sample emails provided.`;

    console.log(`[PROMPT REFINE] Refining prompt for label "${labelName}" for user ${session.user.email}`);

    // Combine system and user prompts for the LLM
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    // Call LLM to refine the prompt
    const refinedText = await llmService.generateText(fullPrompt);
    
    console.log(`[PROMPT REFINE] Successfully refined prompt for "${labelName}" (${refinedText.length} chars)`);

    return NextResponse.json({
      success: true,
      originalPrompt: userDraft,
      refinedPrompt: refinedText.trim(),
      labelName,
      examplesUsed: examples.length
    });

  } catch (error) {
    console.error('Error refining prompt:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to refine prompt' 
    }, { status: 500 });
  }
}