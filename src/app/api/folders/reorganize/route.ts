import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { EmailMappingService } from '@/lib/services/onboarding-services/emailMappingService';
import fs from 'fs';
import path from 'path';

// Types for the reorganization
interface EmailSuggestion {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body?: string;
  date: string;
  suggestedFolder: string;
  confidence: number;
  gmailCategories?: string[];
  isRead?: boolean;
  hasAttachment?: boolean;
  priority?: 'high' | 'medium' | 'low';
  originalData?: any;
}

interface ReorganizationResult {
  folders: Array<{
    id: string;
    name: string;
    description: string;
    instruction: string;
    color: string;
    icon: string;
    emailCount: number;
    isSystemDefault: boolean;
    hardRules: any[];
    examples: any[];
  }>;
  emailChanges: Array<{
    folderId: string;
    emails: EmailSuggestion[];
  }>;
  stats: {
    totalEmails: number;
    emailsMoved: number;
    foldersAffected: number;
  };
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { newFolderId, newFolderInstruction } = body;

    if (!newFolderId) {
      return NextResponse.json({ error: 'newFolderId is required' }, { status: 400 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log(`[REORGANIZE API] Starting email reorganization for user ${user.email}, new folder: ${newFolderId}`);

    // Initialize services
    const emailMappingService = new EmailMappingService();

    // Get all user folders
    const folders = await prisma.label.findMany({
      where: { 
        userId: user.id,
        isCustom: true
      },
      select: {
        id: true,
        name: true,
        metaPrompt: true,
        color: true,
        isSystemDefault: true
      }
    });

    // Get recent emails for analysis (last 100 emails)
    const recentEmails = await prisma.emailSort.findMany({
      where: {
        userId: user.id,
        // Focus on unorganized emails or emails in default folders
        OR: [
          { labelId: undefined },
          { 
            label: { 
              isSystemDefault: true,
              name: { in: ['Inbox', 'Important', 'Review'] }
            }
          }
        ]
      },
      include: {
        label: {
          select: {
            id: true,
            name: true,
            color: true
          }
        }
      },
      orderBy: { sortedAt: 'desc' },
      take: 100
    });

    console.log(`[REORGANIZE API] Found ${recentEmails.length} emails to analyze`);

    // Simulate LLM analysis for reorganization suggestions
    // In a real implementation, this would call an LLM service with the email mapping prompt
    const emailSuggestions: EmailSuggestion[] = [];
    const folderCounts: Record<string, number> = {};
    
    // Initialize folder counts
    folders.forEach(folder => {
      folderCounts[folder.id] = 0;
    });

    // Analyze each email and suggest folders
    for (const emailSort of recentEmails) {
      
      // Simple heuristic-based categorization (in production, this would use LLM)
      let suggestedFolderId = newFolderId; // Default to new folder
      let confidence = 70;

      // Check for existing mappings first
      const existingMapping = await emailMappingService.findMappingForEmail(user.id, (emailSort as any).from || '');
      if (existingMapping.mapping) {
        suggestedFolderId = existingMapping.mapping.labelId;
        confidence = existingMapping.mapping.confidence || 95;
      } else {
        // Use simple keyword matching for suggestions
        const subject = (emailSort as any).subject?.toLowerCase?.() || '';
        const snippet = (emailSort as any).reasoning?.toLowerCase?.() || '';
        const from = (emailSort as any).from?.toLowerCase?.() || '';

        // Check against folder names and their prompts
        for (const folder of folders) {
          const folderName = folder.name.toLowerCase();
          const folderPrompt = folder.metaPrompt?.toLowerCase() || '';
          
          // Simple scoring system
          let score = 0;
          
          if (subject.includes(folderName) || snippet.includes(folderName)) {
            score += 30;
          }
          
          if (from.includes(folderName)) {
            score += 20;
          }

          // Check against common patterns
          if (folderName.includes('newsletter') && (
            from.includes('newsletter') || 
            from.includes('noreply') || 
            subject.includes('unsubscribe')
          )) {
            score += 40;
          }

          if (folderName.includes('notification') && (
            from.includes('notification') ||
            from.includes('alert') ||
            subject.includes('notification')
          )) {
            score += 40;
          }

          if (folderName.includes('financial') && (
            subject.includes('invoice') ||
            subject.includes('receipt') ||
            subject.includes('payment') ||
            from.includes('billing')
          )) {
            score += 40;
          }

          if (score > confidence) {
            suggestedFolderId = folder.id;
            confidence = Math.min(score, 95);
          }
        }
      }

      // Create email suggestion
      const suggestion: EmailSuggestion = {
        id: emailSort.gmailMessageId,
        from: (emailSort as any).from || 'Unknown',
        subject: (emailSort as any).subject || 'No subject',
        snippet: (emailSort as any).snippet || '',
        date: (emailSort as any).sortedAt?.toISOString?.() || new Date().toISOString(),
        suggestedFolder: suggestedFolderId,
        confidence,
        gmailCategories: undefined,
        isRead: undefined,
        hasAttachment: undefined,
        priority: confidence > 85 ? 'high' : confidence > 70 ? 'medium' : 'low'
      };

      emailSuggestions.push(suggestion);
      folderCounts[suggestedFolderId] = (folderCounts[suggestedFolderId] || 0) + 1;
    }

    // Group emails by suggested folder
    const emailChanges = folders.map(folder => ({
      folderId: folder.id,
      emails: emailSuggestions.filter(email => email.suggestedFolder === folder.id)
    })).filter(change => change.emails.length > 0);

    // Calculate stats
    const stats = {
      totalEmails: emailSuggestions.length,
      emailsMoved: emailSuggestions.filter(email => email.confidence > 70).length,
      foldersAffected: emailChanges.length
    };

    // Format folders for response
    const formattedFolders = folders.map(folder => ({
      id: folder.id,
      name: folder.name,
      description: folder.metaPrompt || `Emails related to ${folder.name}`,
      instruction: folder.metaPrompt || `Emails related to ${folder.name}`,
      color: folder.color || '#6366f1',
      icon: getDefaultIcon(folder.name),
      emailCount: folderCounts[folder.id] || 0,
      isSystemDefault: folder.isSystemDefault || false,
      hardRules: [], // TODO: Fetch from email mappings
      examples: []
    }));

    const result: ReorganizationResult = {
      folders: formattedFolders,
      emailChanges,
      stats
    };

    console.log(`[REORGANIZE API] Reorganization complete: ${stats.emailsMoved}/${stats.totalEmails} emails processed across ${stats.foldersAffected} folders`);

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[REORGANIZE API] Error during reorganization:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to reorganize emails',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Helper function to get default icons based on folder names
function getDefaultIcon(folderName: string): string {
  const name = folderName.toLowerCase();
  
  if (name.includes('newsletter') || name.includes('marketing')) return '📧';
  if (name.includes('notification') || name.includes('alert')) return '🔔';
  if (name.includes('financial') || name.includes('bill') || name.includes('invoice')) return '💰';
  if (name.includes('travel') || name.includes('booking')) return '✈️';
  if (name.includes('action') || name.includes('todo')) return '⚡';
  if (name.includes('review') || name.includes('manual')) return '👁️';
  if (name.includes('work') || name.includes('business')) return '💼';
  if (name.includes('personal') || name.includes('family')) return '🏠';
  if (name.includes('shopping') || name.includes('purchase')) return '🛒';
  if (name.includes('health') || name.includes('medical')) return '🏥';
  
  return '📁'; // Default folder icon
}