// Worker-specific types without React dependencies

export interface EmailContextQuery {
  keywords?: string[];
  senderFilter?: string[];
  dateWindowHint?: string;
  hasAttachment?: boolean;
  maxResults?: number;
}

export interface IncomingEmailScannerOutput {
  needsCalendarCheck: boolean;
  calendarParameters?: {
    dateHint?: string;
    durationHint?: string;
    attendees?: string[];
  };
  emailContextQuery: EmailContextQuery;
  urgencyLevel: 'low' | 'medium' | 'high';
  primaryIntent: 'scheduling' | 'information_request' | 'problem_report' | 'status_update' | 'follow_up' | 'other';
  reasoning: string;
}

export interface FinalContextOutput {
  contextualDraft: string;
  suggestedActions: string[];
  confidenceScore: number;
  reasoning: string;
  keyFactsUsed: string[];
  emailSummary?: string;
}

export interface CalendarAvailabilityCheck {
  isFree: boolean;
  conflictingEvents: CalendarEvent[];
  suggestedTimes?: Array<{
    start: string;
    end: string;
  }>;
}

export interface ContextualInformation {
  calendarData?: {
    availability: CalendarAvailabilityCheck;
    relevantEvents: CalendarEvent[];
    summary: string;
  };
  emailContext: {
    relevantEmails: Array<{
      from: string;
      to: string[];
      subject: string;
      body: string;
      date: Date;
      isSent: boolean;
      snippet: string;
    }>;
    summary: string;
  };
  scannerOutput: IncomingEmailScannerOutput;
  finalContext: FinalContextOutput;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
  status: 'confirmed' | 'tentative' | 'cancelled';
  location?: string;
}

export interface CalendarAvailability {
  date: string; // YYYY-MM-DD format
  availableSlots: Array<{
    start: string; // HH:MM format
    end: string;   // HH:MM format
  }>;
} 
