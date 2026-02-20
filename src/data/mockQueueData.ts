import { QueueItem } from '@/types';

/**
 * 🎭 MOCK QUEUE DATA - DO NOT REMOVE
 * 
 * Purpose: Enables QueuePage modal styling preview without real email data
 * Usage: Pass useMockData={true} to QueuePage component or NEXT_PUBLIC_DEV_QUEUE_SANDBOX=full
 * Contains diverse email scenarios with realistic content and metadata.
 * Includes mailboxEmail/mailboxId for multi-inbox UI testing (sara@starboard.ai + rushikatclira@gmail.com).
 */

export const mockQueueItems: QueueItem[] = [
  {
    id: 'mock-urgent-meeting',
    actionSummary: 'Reply to: Urgent Meeting Request - Tomorrow 2PM',
    contextSummary: 'Rushik is requesting an emergency meeting about the Q4 budget review. He needs confirmation by end of day.',
    status: 'needs-attention',
    confidence: 95,
    draftPreview: "Hi Rushik,\n\nI can definitely attend the meeting tomorrow at 2PM. I'll prepare the Q4 budget analysis and bring the latest forecasts.\n\nShould I invite the finance team as well?",
    fullDraft: "Hi Rushik,\n\nI can definitely attend the meeting tomorrow at 2PM. I'll prepare the Q4 budget analysis and bring the latest forecasts.\n\nShould I invite the finance team as well? I think having Tom and Jessica there would be valuable given the scope of the discussion.\n\nLet me know if you need anything else before the meeting.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-1',
      from: 'rushik.behal@company.com',
      mailboxId: 'mock-mb-1',
      mailboxEmail: 'sara@starboard.ai',
      subject: 'URGENT: Emergency Budget Meeting Tomorrow 2PM',
      body: "Hi Rushik,\n\nWe need to have an emergency meeting tomorrow at 2PM to discuss some critical Q4 budget items that came up in the board meeting.\n\nCan you attend? Please confirm by end of day.\n\nThis is urgent - we need to align on the budget before the investor call on Friday.\n\nThanks,\nSarah\n\nSarah Johnson\nCEO, TechCorp Inc.",
      receivedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 minutes ago
      labels: [
        {
          id: 'label-1',
          name: 'Urgent',
          color: '#dc2626',
          gmailLabelId: 'gmail-urgent-label'
        },
        {
          id: 'label-2',
          name: 'Budget',
          color: '#2563eb',
          gmailLabelId: 'gmail-budget-label'
        },
        {
          id: 'label-3',
          name: 'Meeting',
          color: '#7c3aed',
          gmailLabelId: 'gmail-meeting-label'
        }
      ]
    },
  },
  {
    id: 'mock-project-update',
    actionSummary: 'Reply to: Q4 Campaign Status Update?',
    contextSummary: 'Marketing Director Sarah Chen is asking for a status update on the Q4 marketing campaign. She needs this information for tomorrow\'s leadership meeting.',
    status: 'needs-attention',
    confidence: 88,
    draftPreview: "Hi Sarah,\n\nThanks for checking in on the Q4 campaign. We're making great progress - the creative assets are 80% complete and the media buy is scheduled for next week. I'll send you a detailed report by Friday with all the metrics and timelines.\n\nLet me know if you need any specific information before then!",
    fullDraft: "Hi Sarah,\n\nThanks for checking in on the Q4 campaign. We're making great progress - the creative assets are 80% complete and the media buy is scheduled for next week. I'll send you a detailed report by Friday with all the metrics and timelines.\n\nLet me know if you need any specific information before then!\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-2',
      from: 'sarah.chen@company.com',
      mailboxId: 'mock-mb-2',
      mailboxEmail: 'rushikatclira@gmail.com',
      subject: 'Q4 Campaign Status Update?',
      body: "Hey,\n\nHope you're doing well! Just wanted to check in on the Q4 marketing campaign. The leadership team is asking for an update, and I wanted to get the latest from you before our meeting tomorrow.\n\nCould you send me a quick status update? Particularly interested in:\n- Creative asset progress\n- Media buy timeline\n- Any blockers we should be aware of\n\nThanks!\nSarah",
      receivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      labels: [
        {
          id: 'label-4',
          name: 'Marketing',
          color: '#059669',
          gmailLabelId: 'gmail-marketing-label'
        },
        {
          id: 'label-5',
          name: 'Campaign',
          color: '#0891b2',
          gmailLabelId: 'gmail-campaign-label'
        },
        {
          id: 'label-6',
          name: 'Q4',
          color: '#d97706',
          gmailLabelId: 'gmail-q4-label'
        }
      ]
    },
  },
  {
    id: 'mock-vendor-inquiry',
    actionSummary: 'Reply to: Software License Renewal Quote Request',
    contextSummary: 'Lisa from TechSolutions is following up on our software license renewal and asking about our requirements for the new contract.',
    status: 'needs-attention',
    confidence: 72,
    draftPreview: "Hi Lisa,\n\nThanks for reaching out about the license renewal. We'll need to expand our user count to 150 seats for the next year.\n\nCan you send a quote including the premium support package?",
    fullDraft: "Hi Lisa,\n\nThanks for reaching out about the license renewal. I've been meaning to get back to you on this.\n\nFor the upcoming renewal, we'll need to expand our user count to 150 seats (up from our current 100) to accommodate our growing team.\n\nCan you please send a quote that includes:\n- 150 user licenses\n- Premium support package\n- Training sessions for new users\n- Any available discounts for multi-year commitments\n\nOur current contract expires on January 15th, so we'd like to finalize this by mid-December.\n\nLet me know if you need any additional information.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-3',
      from: 'lisa.martinez@techsolutions.com',
      mailboxId: 'mock-mb-1',
      mailboxEmail: 'sara@starboard.ai',
      subject: 'Follow-up: Software License Renewal - Action Needed',
      body: "Hi Rushik,\n\nI wanted to follow up on our conversation last month about renewing your software licenses.\n\nYour current contract expires on January 15th, and I'd like to help you secure the best pricing for the renewal.\n\nCould you let me know:\n1. How many user licenses you'll need for next year?\n2. Are you interested in upgrading to our premium support package?\n3. Would you like to schedule a call to discuss options?\n\nI'm here to help make this process as smooth as possible.\n\nBest regards,\nLisa Martinez\nAccount Manager, TechSolutions",
      receivedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
    },
  },
  {
    id: 'mock-client-complaint',
    actionSummary: 'Reply to: Customer Service Issue - Order #12345',
    contextSummary: 'Frustrated customer David Williams reporting a problem with his recent order delivery and requesting immediate assistance.',
    status: 'needs-attention',
    confidence: 91,
    draftPreview: "Dear Mr. Williams,\n\nI sincerely apologize for the delivery issues with order #12345. I understand your frustration and want to resolve this immediately.\n\nI'm personally looking into this matter and will have an update within 24 hours.",
    fullDraft: "Dear Mr. Williams,\n\nI sincerely apologize for the delivery issues with order #12345. I understand your frustration, especially given that this was a time-sensitive purchase.\n\nHere's what I'm doing to resolve this immediately:\n\n1. I've escalated your case to our logistics manager\n2. We're tracking down your package with the carrier\n3. As a gesture of goodwill, I'm processing a full refund while we resolve the delivery issue\n4. You'll also receive a 20% discount on your next order\n\nI will personally follow up with you within 24 hours with a complete update. You can reach me directly at this email or call our priority line at (555) 123-4567.\n\nThank you for your patience, and again, my sincere apologies for this experience.\n\nBest regards,\nRushik\nCustomer Success Manager",
    metadata: {
      emailId: 'mock-4',
      from: 'david.williams@email.com',
      mailboxId: 'mock-mb-2',
      mailboxEmail: 'rushikatclira@gmail.com',
      subject: 'COMPLAINT: Order #12345 - Still Not Delivered After 2 Weeks',
      body: "To Whom It May Concern,\n\nI am extremely frustrated with your company's service. I placed order #12345 two weeks ago and it still hasn't been delivered.\n\nThis was supposed to be a birthday gift for my daughter, and now her birthday has passed. Your tracking system shows it was \"out for delivery\" for the past 5 days, which is obviously wrong.\n\nI've called your customer service line three times and each person tells me something different. This is completely unacceptable.\n\nI demand:\n1. Immediate resolution of my delivery issue\n2. Full refund for the shipping charges\n3. Compensation for this terrible experience\n\nIf this isn't resolved within 24 hours, I will be filing a complaint with the Better Business Bureau and posting negative reviews everywhere.\n\nDavid Williams\nOrder #12345",
      receivedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    },
  },
  {
    id: 'mock-team-invitation',
    actionSummary: 'Reply to: Invitation to Join Cross-Functional Team',
    contextSummary: 'HR Director Emma Thompson is inviting you to join a new cross-functional team for the digital transformation initiative.',
    status: 'auto-approved',
    confidence: 85,
    draftPreview: "Hi Emma,\n\nThank you for thinking of me for the digital transformation team. I'm very interested in participating and believe I can contribute valuable insights from the technical side.\n\nWhen does the team officially start?",
    fullDraft: "Hi Emma,\n\nThank you for thinking of me for the digital transformation team. I'm very interested in participating and believe I can contribute valuable insights from the technical perspective.\n\nThis initiative aligns perfectly with some of the ideas I've been developing around process automation and system integration. I'm particularly excited about the opportunity to work across departments and help drive meaningful change.\n\nA few questions:\n- When does the team officially start meeting?\n- What's the expected time commitment per week?\n- Will this be in addition to my current role or a partial reassignment?\n\nI'm definitely interested and look forward to hearing more details.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-5',
      from: 'emma.thompson@company.com',
      mailboxId: 'mock-mb-1',
      mailboxEmail: 'sara@starboard.ai',
      subject: 'Invitation: Join Our Digital Transformation Team',
      body: "Hi Rushik,\n\nI hope you're doing well!\n\nI'm reaching out because we're forming a new cross-functional team to lead our digital transformation initiative, and I immediately thought of you.\n\nGiven your technical expertise and collaborative approach, I believe you'd be a perfect fit for this team. We're looking for innovative thinkers who can help us modernize our processes and improve efficiency across the organization.\n\nThe team will include representatives from IT, Operations, Marketing, and Finance. We'll be meeting twice a week initially, with the goal of presenting recommendations to the executive team by March.\n\nWould you be interested in joining us? I'd love to discuss this opportunity with you further.\n\nBest regards,\nEmma Thompson\nHR Director",
      receivedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
    },
  },
  {
    id: 'mock-conference-speaker',
    actionSummary: 'Reply to: Speaking Opportunity at TechConf 2024',
    contextSummary: 'Conference organizer Alex Rodriguez is inviting you to speak at TechConf 2024 about your expertise in AI and automation.',
    status: 'needs-attention',
    confidence: 79,
    draftPreview: "Hi Alex,\n\nThank you for the speaking invitation to TechConf 2024. I'm honored that you thought of me for this opportunity.\n\nI'd love to discuss the details further. Could we schedule a brief call this week?",
    fullDraft: "Hi Alex,\n\nThank you for the speaking invitation to TechConf 2024. I'm honored that you thought of me for this opportunity, and the topic of AI automation in business processes is definitely something I'm passionate about.\n\nI'd be very interested in participating. A few questions:\n\n- What's the expected presentation length?\n- What's the audience composition (technical level, company sizes, etc.)?\n- Are there specific aspects of AI automation you'd like me to focus on?\n- What are the dates and location for the conference?\n- Do you cover travel and accommodation expenses?\n\nI have some compelling case studies and practical insights I could share, particularly around implementation challenges and ROI measurement.\n\nCould we schedule a brief call this week to discuss the details further?\n\nLooking forward to hearing from you.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-6',
      from: 'alex.rodriguez@techconf.org',
      mailboxId: 'mock-mb-2',
      mailboxEmail: 'rushikatclira@gmail.com',
      subject: 'Speaking Invitation: TechConf 2024 - AI & Automation Track',
      body: "Hi Rushik,\n\nI hope this email finds you well.\n\nI'm Alex Rodriguez, the program director for TechConf 2024. I've been following your work in AI and automation, and I'm impressed by the innovative solutions you've been developing.\n\nWe'd love to invite you to speak at TechConf 2024 in our AI & Automation track. The conference will be held in San Francisco from April 15-17, and we're expecting over 2,000 attendees from leading tech companies.\n\nYour presentation would focus on practical applications of AI in business process automation, sharing real-world examples and lessons learned.\n\nWe offer:\n- Speaker fee of $2,500\n- Full travel and accommodation coverage\n- Access to all conference sessions\n- Networking opportunities with industry leaders\n\nThis is an extremely long email to test the modal scrolling behavior. I'm adding significantly more content here to ensure that our EmailViewer modal can handle very long emails without going off-screen or cutting off content.\n\nHere are some additional details about the conference:\n\n**Conference Schedule:**\nDay 1 (April 15): Opening keynotes, AI fundamentals track, networking reception\nDay 2 (April 16): Advanced AI applications, your presentation slot, workshop sessions\nDay 3 (April 17): Future of AI panel, closing ceremonies, sponsor exhibitions\n\n**Your Presentation Details:**\n- Time slot: Day 2, 2:30 PM - 3:15 PM (45 minutes including Q&A)\n- Expected audience: 300-400 attendees\n- Stage setup: Large screen, wireless microphone, clicker for slides\n- Technical requirements: We support PowerPoint, Keynote, or PDF presentations\n- Recording: All sessions are recorded for our online platform (with speaker consent)\n\n**Travel and Accommodation:**\n- Flight: We'll book your preferred airline and class (business class for speakers)\n- Hotel: 3 nights at the Marriott Downtown San Francisco (conference venue)\n- Ground transportation: Uber credits provided for airport transfers\n- Meals: All conference meals included, plus speaker dinner on April 15th\n\n**Speaker Benefits:**\n- Professional headshots during the conference\n- Recording of your presentation for your own use\n- Access to our exclusive speaker networking event\n- Opportunity to participate in our podcast series\n- Written summary of your talk for our conference proceedings\n\n**Conference Theme:**\nThis year's theme is 'AI in Action: From Theory to Impact' and we're focusing on real-world implementations, challenges overcome, and measurable business outcomes. Your talk would fit perfectly in our 'Automation Success Stories' session.\n\n**Additional Opportunities:**\n- Workshop facilitation: Would you be interested in running a hands-on workshop?\n- Panel participation: We have an 'AI Ethics in Business' panel that could benefit from your perspective\n- Mentor sessions: One-on-one sessions with conference attendees seeking career advice\n\n**About TechConf:**\nNow in its 8th year, TechConf has become the premier West Coast conference for AI and automation professionals. Past speakers include CTOs from Google, Microsoft, Amazon, and leading startups. Our attendees represent over 500 companies ranging from Fortune 500 enterprises to innovative startups.\n\n**Logistics:**\n- Conference venue: Marriott Marquis San Francisco, 780 Mission Street\n- Registration desk opens: April 14th at 6 PM for speaker check-in\n- AV tech check: April 15th at 8 AM (recommended for all speakers)\n- Speaker green room: Available throughout the conference\n- Emergency contact: My direct phone number for any urgent needs\n\nWould you be interested in this opportunity? I'd be happy to discuss the details further. We typically need confirmation within 2 weeks to finalize our speaker lineup and begin marketing materials.\n\nI'm also attaching our speaker kit which includes presentation guidelines, branding requirements, and a sample presentation template. Please let me know if you have any questions or if there's anything else you'd like to know about the conference.\n\nLooking forward to potentially having you join our amazing lineup of speakers!\n\nBest regards,\nAlex Rodriguez\nProgram Director, TechConf 2024\nEmail: alex@techconf.org\nPhone: (415) 555-0199\nLinkedIn: /in/alexrodrigueztech\n\nP.S. If you know of any other experts in AI automation who might be interested in speaking, please don't hesitate to make introductions. We're always looking for diverse perspectives and innovative voices in our field.",
      receivedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
    },
  },
  {
    id: 'mock-invoice-payment',
    actionSummary: 'Reply to: Invoice Payment Reminder - Overdue',
    contextSummary: 'Accounting team member Rachel Kim is following up on an overdue invoice payment that needs immediate attention.',
    status: 'needs-attention',
    confidence: 96,
    draftPreview: "Hi Rachel,\n\nThank you for the reminder. I've processed the payment for invoice #INV-2024-089 today.\n\nYou should see the funds in your account within 1-2 business days.",
    fullDraft: "Hi Rachel,\n\nThank you for the reminder about invoice #INV-2024-089. I apologize for the delay - this invoice got caught up in our approval process.\n\nI've processed the payment today for the full amount of $2,450.00. The payment has been sent via bank transfer to the account details on your invoice.\n\nYou should see the funds in your account within 1-2 business days. Please let me know if you need any additional documentation or if there are any issues with the payment.\n\nGoing forward, I'll ensure our team processes your invoices more promptly. Thank you for your patience.\n\nBest regards,\nRushik\nFinance Manager",
    metadata: {
      emailId: 'mock-7',
      from: 'rachel.kim@company.com',
      mailboxId: 'mock-mb-1',
      mailboxEmail: 'sara@starboard.ai',
      subject: 'URGENT: Invoice #INV-2024-089 Payment Overdue - Action Required',
      body: "Hi Rushik,\n\nI'm following up on invoice #INV-2024-089 for $2,450.00 which was due on December 1st.\n\nThis invoice is now 15 days overdue and we need immediate payment to avoid any late fees or service interruptions.\n\nPlease process the payment today and confirm once completed. If you have any questions about this invoice or need to discuss payment terms, please let me know immediately.\n\nThank you for your prompt attention to this matter.\n\nBest regards,\nRachel Kim\nAccounts Receivable Specialist",
      receivedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 minutes ago
    },
  },
  {
    id: 'mock-job-application',
    actionSummary: 'Reply to: Senior Developer Position Application',
    contextSummary: 'HR Manager Kevin Patel is responding to your job application for the Senior Developer position with next steps.',
    status: 'auto-approved',
    confidence: 82,
    draftPreview: "Hi Kevin,\n\nThank you for the positive feedback on my application. I'm excited about the opportunity and would love to proceed with the next steps.\n\nI'm available for the technical interview next week.",
    fullDraft: "Hi Kevin,\n\nThank you for the positive feedback on my application for the Senior Developer position. I'm excited about the opportunity to join your team and contribute to the exciting projects you have planned.\n\nI'm definitely interested in moving forward with the next steps. For the technical interview, I'm available:\n\n- Monday, December 16th: 2-4 PM\n- Wednesday, December 18th: 10 AM-12 PM\n- Friday, December 20th: 1-3 PM\n\nI'm also happy to accommodate other times if those don't work for your team. I'll prepare by reviewing the technical requirements and thinking through some of the challenges you mentioned.\n\nLooking forward to meeting the team and discussing how I can contribute to your success.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-8',
      from: 'kevin.patel@company.com',
      mailboxId: 'mock-mb-2',
      mailboxEmail: 'rushikatclira@gmail.com',
      subject: 'Re: Senior Developer Position - Next Steps',
      body: "Hi Rushik,\n\nThank you for your application for the Senior Developer position. We were impressed with your background and experience, particularly your work with AI integration and automation systems.\n\nWe'd like to move forward with the next step in our process, which is a technical interview with our development team. This will include:\n- A 1-hour technical discussion\n- A coding challenge (take-home, 2-3 hours)\n- Q&A about your previous projects\n\nAre you still interested in the position? If so, when would you be available for the technical interview next week?\n\nWe're looking to fill this role quickly, so we'd like to move through the process efficiently.\n\nBest regards,\nKevin Patel\nHR Manager",
      receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
    },
  },
  {
    id: 'mock-product-feedback',
    actionSummary: 'Reply to: Beta Testing Feedback - New Feature',
    contextSummary: 'Product Manager Jennifer Lee is requesting detailed feedback on the new beta feature you\'ve been testing.',
    status: 'needs-attention',
    confidence: 68,
    draftPreview: "Hi Jennifer,\n\nI've been testing the new beta feature and have some valuable feedback to share.\n\nOverall, the functionality is solid but there are a few UX improvements that could make it more intuitive.",
    fullDraft: "Hi Jennifer,\n\nI've been thoroughly testing the new beta feature over the past week and have some valuable feedback to share.\n\n**What's Working Well:**\n- The core functionality is solid and performs reliably\n- The integration with existing workflows is seamless\n- Performance is excellent even with large datasets\n\n**Areas for Improvement:**\n- The user interface could be more intuitive - some users might struggle with the current navigation\n- The onboarding flow needs better guidance for new users\n- Mobile responsiveness could be enhanced for tablet users\n\n**Specific Issues Found:**\n- Export function occasionally fails with files larger than 50MB\n- Search results don't always highlight the most relevant matches first\n- Some keyboard shortcuts conflict with browser defaults\n\n**Suggestions:**\n\n- Consider adding a 'favorites' feature for frequently used functions\n- The color scheme could be more accessible for users with visual impairments\n\nOverall, this is a strong foundation that just needs some UX polish. I'm happy to discuss any of these points in more detail.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-9',
      from: 'jennifer.lee@company.com',
      mailboxId: 'mock-mb-1',
      mailboxEmail: 'sara@starboard.ai',
      subject: 'Beta Testing Feedback Request - New Analytics Dashboard',
      body: "Hi Rushik,\n\nI hope you're enjoying testing our new analytics dashboard beta feature!\n\nAs we're getting close to the final release, I'd love to get your detailed feedback on:\n\n1. Overall user experience and ease of use\n2. Any bugs or issues you've encountered\n3. Features that work well vs. those that need improvement\n4. Suggestions for enhancements or new features\n5. Performance and reliability\n\nWe've been getting great feedback so far, but your technical perspective would be particularly valuable given your expertise.\n\nCould you share your thoughts by the end of the week? We're planning to finalize the feature next Monday.\n\nThanks for your help!\n\nBest regards,\nJennifer Lee\nProduct Manager",
      receivedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), // 8 hours ago
    },
  },
  {
    id: 'mock-partnership-proposal',
    actionSummary: 'Reply to: Strategic Partnership Opportunity Discussion',
    contextSummary: 'Business Development Director Mark Thompson is proposing a strategic partnership between your companies.',
    status: 'needs-attention',
    confidence: 87,
    draftPreview: "Hi Mark,\n\nThank you for the partnership proposal. This is an interesting opportunity that aligns well with our strategic goals.\n\nI'd like to schedule a call to discuss the details and explore how we can work together.",
    fullDraft: "Hi Mark,\n\nThank you for reaching out with this partnership proposal. After reviewing the materials you sent, this is definitely an interesting opportunity that aligns well with our strategic goals for 2024.\n\nI'm particularly excited about the potential synergies between our AI automation platform and your enterprise workflow solutions. The combination could create significant value for our mutual customers.\n\nI'd like to schedule a call to discuss this in more detail. Some areas I'd like to explore:\n\n- Specific partnership structure and revenue sharing model\n- Technical integration requirements and timeline\n- Market opportunity and target customer segments\n- Resource commitments from both sides\n- Success metrics and KPIs\n\nI'm available for a 45-minute call next week:\n- Tuesday, December 17th: 1-2 PM\n- Thursday, December 19th: 3-4 PM\n- Friday, December 20th: 10-11 AM\n\nLet me know what works best for you, and I'll send a calendar invite with the agenda.\n\nLooking forward to exploring this opportunity together.\n\nBest regards,\nRushik\nVP of Business Development",
    metadata: {
      emailId: 'mock-10',
      from: 'mark.thompson@partnersolutions.com',
      mailboxId: 'mock-mb-2',
      mailboxEmail: 'rushikatclira@gmail.com',
      subject: 'Strategic Partnership Opportunity - AI Automation Integration',
      body: "Hi Rushik,\n\nI hope this email finds you well. I'm Mark Thompson, Director of Business Development at PartnerSolutions.\n\nI've been following your company's impressive growth in the AI automation space, and I believe we have a compelling opportunity to explore a strategic partnership.\n\nOur enterprise workflow platform serves over 500 Fortune 1000 companies, and we're looking to enhance our offering with advanced AI capabilities. Your automation technology could be the perfect complement.\n\nI've attached a brief overview of our proposal, which includes:\n- Joint go-to-market strategy\n- Technical integration roadmap\n- Revenue sharing model\n- Market opportunity analysis\n\nWould you be interested in discussing this opportunity? I'd love to schedule a call to explore how we might work together.\n\nBest regards,\nMark Thompson\nDirector of Business Development\nPartnerSolutions Inc.",
      receivedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
    },
  },
  {
    id: 'mock-emergency-support',
    actionSummary: 'Reply to: Critical System Outage - Immediate Support Needed',
    contextSummary: 'IT Support Manager Carlos Rodriguez is reporting a critical system outage affecting multiple departments.',
    status: 'needs-attention',
    confidence: 94,
    draftPreview: "Hi Carlos,\n\nI'm aware of the critical system outage and am working on it immediately.\n\nI've escalated this to our infrastructure team and we're implementing emergency protocols.",
    fullDraft: "Hi Carlos,\n\nI'm aware of the critical system outage and am working on it immediately. This is our top priority right now.\n\n**Immediate Actions Taken:**\n- Escalated to our infrastructure team\n- Implemented emergency protocols\n- Notified all affected stakeholders\n- Started rolling back to the last stable version\n\n**Current Status:**\n- Core systems are down for approximately 200 users\n- Database connectivity issues identified\n- Backup systems are operational\n\n**Estimated Resolution:**\n- Immediate fix: 30-45 minutes\n- Full system restoration: 2-3 hours\n- Complete stability verification: 4-6 hours\n\nI'll provide updates every 30 minutes until this is resolved. Please let your team know that we're working on this as fast as possible.\n\nFor urgent business-critical operations, we have manual workarounds available. Let me know if you need those details.\n\nBest regards,\nRushik\nSenior DevOps Engineer",
    metadata: {
      emailId: 'mock-11',
      from: 'carlos.rodriguez@company.com',
      mailboxId: 'mock-mb-1',
      mailboxEmail: 'sara@starboard.ai',
      subject: 'CRITICAL: System Outage - Multiple Departments Affected',
      body: "URGENT - IMMEDIATE ATTENTION REQUIRED\n\nHi Rushik,\n\nWe have a critical system outage affecting:\n- Sales team (50 users)\n- Customer service (30 users)\n- Marketing operations (20 users)\n- Finance reporting (15 users)\n\nUsers are unable to:\n- Access customer databases\n- Process transactions\n- Generate reports\n- Send communications\n\nThis is impacting our ability to serve customers and conduct business operations.\n\nPlease respond immediately with:\n1. Current status and root cause\n2. Estimated time to resolution\n3. Any immediate workarounds\n4. Communication plan for affected teams\n\nThis is business-critical and needs your immediate attention.\n\nCarlos Rodriguez\nIT Support Manager",
      receivedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
    },
  },
  {
    id: 'mock-training-request',
    actionSummary: 'Reply to: Team Training Request - New Software Implementation',
    contextSummary: 'Operations Manager Lisa Chen is requesting training sessions for the team on new software being implemented next month.',
    status: 'auto-approved',
    confidence: 76,
    draftPreview: "Hi Lisa,\n\nI'd be happy to help with the team training for the new software implementation.\n\nI can schedule 2-hour sessions over the next two weeks to ensure everyone is comfortable before the rollout.",
    fullDraft: "Hi Lisa,\n\nI'd be happy to help with the team training for the new software implementation. This is a great idea to ensure a smooth transition.\n\n**Training Plan Proposal:**\n- 2-hour sessions per team (Sales, Operations, Finance)\n- Hands-on practice with real scenarios\n- Q&A sessions and troubleshooting guides\n- Follow-up support during the first week of implementation\n\n**Schedule Options:**\n- Week 1: Sales team (Tuesday & Thursday)\n- Week 2: Operations team (Monday & Wednesday)\n- Week 3: Finance team (Tuesday & Thursday)\n\n**Training Materials:**\n- Step-by-step user guides\n- Video tutorials for common tasks\n- Quick reference cards\n- Troubleshooting FAQ\n\nI can also arrange for the software vendor to join one session to answer technical questions.\n\nDoes this approach work for you? I'm flexible on the timing and can adjust based on your team's availability.\n\nBest regards,\nRushik\nTraining Coordinator",
    metadata: {
      emailId: 'mock-12',
      from: 'lisa.chen@company.com',
      mailboxId: 'mock-mb-2',
      mailboxEmail: 'rushikatclira@gmail.com',
      subject: 'Team Training Request - New CRM Software Implementation',
      body: "Hi Rushik,\n\nI hope you're doing well!\n\nWe're implementing the new CRM software next month, and I'd like to request training sessions for our teams before the rollout.\n\nWe need to train:\n- Sales team (12 people)\n- Operations team (8 people)\n- Finance team (5 people)\n\nThe training should cover:\n- Basic navigation and common tasks\n- Data migration and setup\n- Reporting and analytics features\n- Troubleshooting common issues\n\nCould you help us organize these training sessions? We'd like to complete them at least a week before the implementation date.\n\nLet me know what options you have available and what the training would involve.\n\nThanks!\n\nBest regards,\nLisa Chen\nOperations Manager",
      receivedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
    },
  },
  {
    id: 'mock-client-feedback',
    actionSummary: 'Reply to: Client Feedback on New Feature',
    contextSummary: 'Product Manager David Kim is sharing client feedback about the new dashboard feature. They need a response to address concerns.',
    status: 'needs-attention',
    confidence: 78,
    draftPreview: "Hi David,\n\nThanks for sharing the client feedback. I've reviewed the concerns about the dashboard feature and I can see where the confusion is coming from. Let me address each point and propose some solutions.",
    fullDraft: "Hi David,\n\nThanks for sharing the client feedback. I've reviewed the concerns about the dashboard feature and I can see where the confusion is coming from.\n\n**Key Issues Identified:**\n1. Navigation complexity - The menu structure is too deep\n2. Performance concerns - Loading times on mobile devices\n3. Feature discoverability - Some important functions are hard to find\n\n**Proposed Solutions:**\n1. Simplify the navigation to max 2 levels deep\n2. Implement lazy loading for better mobile performance\n3. Add a 'Quick Actions' panel for frequently used features\n\nI'd like to schedule a call to discuss these changes in detail. When would work best for you?\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-3',
      from: 'david.kim@company.com',
      mailboxId: 'mock-mb-2',
      mailboxEmail: 'rushikatclira@gmail.com',
      subject: 'Client Feedback: New Dashboard Feature Concerns',
      body: "Hi team,\n\nI just got off a call with our biggest client about the new dashboard feature we launched last week. They have some concerns that I think we need to address quickly:\n\n1. The navigation is too complex - they're getting lost trying to find basic functions\n2. Performance on mobile devices is slower than expected\n3. Some key features are buried and hard to discover\n\nCan you review this and let me know how we should respond? They're expecting a detailed reply by end of day.\n\nThanks,\nDavid",
      receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
      labels: [
        {
          id: 'label-7',
          name: 'Client',
          color: '#be185d',
          gmailLabelId: 'gmail-client-label'
        },
        {
          id: 'label-8',
          name: 'Feedback',
          color: '#ea580c',
          gmailLabelId: 'gmail-feedback-label'
        },
        {
          id: 'label-9',
          name: 'Product',
          color: '#0d9488',
          gmailLabelId: 'gmail-product-label'
        }
      ]
    },
  },
  {
    id: 'mock-invoice-approval',
    actionSummary: 'Reply to: Invoice Approval Request - $15,750',
    contextSummary: 'Finance Manager Lisa Wang needs approval for a large invoice from our design agency. This is for the website redesign project.',
    status: 'needs-attention',
    confidence: 92,
    draftPreview: "Hi Lisa,\n\nI've reviewed the invoice for the website redesign project and I can approve this. The work quality has been excellent and the deliverables match our requirements perfectly.",
    fullDraft: "Hi Lisa,\n\nI've reviewed the invoice for the website redesign project and I can approve this. The work quality has been excellent and the deliverables match our requirements perfectly.\n\n**Approval Details:**\n- Invoice Amount: $15,750\n- Project: Website Redesign Phase 2\n- Agency: Creative Solutions Inc.\n- Due Date: 30 days from receipt\n\nPlease proceed with the payment processing. Let me know if you need any additional documentation or have questions.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-4',
      from: 'lisa.wang@company.com',
      mailboxId: 'mock-mb-1',
      mailboxEmail: 'sara@starboard.ai',
      subject: 'Invoice Approval Request - Website Redesign $15,750',
      body: "Hi Rushik,\n\nI have an invoice that requires your approval:\n\n**Invoice Details:**\n- Vendor: Creative Solutions Inc.\n- Amount: $15,750\n- Project: Website Redesign Phase 2\n- Due Date: 30 days from receipt\n\nThis covers the design work completed last month. I've reviewed the deliverables and they meet our specifications.\n\nCan you please review and approve this invoice? I need to process the payment by end of week.\n\nThanks,\nLisa\n\nLisa Wang\nFinance Manager",
      receivedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
      labels: [
        {
          id: 'label-10',
          name: 'Finance',
          color: '#16a34a',
          gmailLabelId: 'gmail-finance-label'
        },
        {
          id: 'label-11',
          name: 'Approval',
          color: '#9333ea',
          gmailLabelId: 'gmail-approval-label'
        },
        {
          id: 'label-12',
          name: 'Invoice',
          color: '#ca8a04',
          gmailLabelId: 'gmail-invoice-label'
        }
      ]
    },
  },
  {
    id: 'mock-team-hiring',
    actionSummary: 'Reply to: New Team Member Onboarding Request',
    contextSummary: 'HR Director Mike Rodriguez is asking about onboarding plans for the new senior developer joining next week.',
    status: 'needs-attention',
    confidence: 85,
    draftPreview: "Hi Mike,\n\nThanks for reaching out about the new team member onboarding. I've prepared a comprehensive onboarding plan that includes technical setup, team introductions, and project assignments.",
    fullDraft: "Hi Mike,\n\nThanks for reaching out about the new team member onboarding. I've prepared a comprehensive onboarding plan that includes technical setup, team introductions, and project assignments.\n\n**Onboarding Plan:**\n1. **Day 1-2:** Technical setup and environment configuration\n2. **Day 3-4:** Team introductions and company overview\n3. **Week 2:** Project assignment and codebase familiarization\n4. **Week 3:** First feature development with mentorship\n\nI've also assigned Alex as their mentor for the first month. Let me know if you'd like me to adjust any part of this plan.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-5',
      from: 'mike.rodriguez@company.com',
      mailboxId: 'mock-mb-2',
      mailboxEmail: 'rushikatclira@gmail.com',
      subject: 'New Team Member Onboarding - Senior Developer',
      body: "Hi Rushik,\n\nWe have a new senior developer joining the team next Monday, and I wanted to check in about the onboarding plan.\n\n**New Hire Details:**\n- Name: Jennifer Chen\n- Role: Senior Full-Stack Developer\n- Start Date: Next Monday\n- Experience: 8 years in React/Node.js\n\nI know you've handled onboarding for technical team members before. Could you share your planned approach? I want to make sure we give Jennifer the best possible start.\n\nAlso, who would you recommend as her mentor for the first few weeks?\n\nThanks,\nMike\n\nMike Rodriguez\nHR Director",
      receivedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
      labels: [
        {
          id: 'label-13',
          name: 'HR',
          color: '#e11d48',
          gmailLabelId: 'gmail-hr-label'
        },
        {
          id: 'label-14',
          name: 'Onboarding',
          color: '#0ea5e9',
          gmailLabelId: 'gmail-onboarding-label'
        },
        {
          id: 'label-15',
          name: 'Team',
          color: '#84cc16',
          gmailLabelId: 'gmail-team-label'
        }
      ]
    },
  },
  {
    id: 'mock-bug-report',
    actionSummary: 'Reply to: Critical Bug Report - Payment System Down',
    contextSummary: 'Support Lead Emma Thompson is reporting a critical bug in the payment system that\'s affecting customer transactions.',
    status: 'needs-attention',
    confidence: 95,
    draftPreview: "Hi Emma,\n\nThanks for the urgent bug report. I've identified the issue and our team is working on a fix. This appears to be related to the recent database migration.",
    fullDraft: "Hi Emma,\n\nThanks for the urgent bug report. I've identified the issue and our team is working on a fix. This appears to be related to the recent database migration.\n\n**Issue Analysis:**\n- Root Cause: Database connection timeout during peak hours\n- Impact: Payment processing delays (2-5 minutes)\n- Affected Users: ~15% of transactions\n\n**Immediate Actions:**\n1. ✅ Database connection pool increased\n2. ✅ Monitoring alerts configured\n3. 🔄 Performance optimization in progress\n\n**ETA for Full Fix:** 2-3 hours\n\nI'll keep you updated on the progress. Please let customers know we're aware of the issue and working on it.\n\nBest regards,\nRushik",
    metadata: {
      emailId: 'mock-6',
      from: 'emma.thompson@company.com',
      mailboxId: 'mock-mb-1',
      mailboxEmail: 'sara@starboard.ai',
      subject: 'URGENT: Payment System Bug - Transactions Failing',
      body: "Hi Rushik,\n\nWe're experiencing a critical issue with the payment system:\n\n**Problem:**\n- Customer payments are taking 2-5 minutes to process\n- Some transactions are failing completely\n- Support tickets are flooding in\n\n**Impact:**\n- Affecting customer experience\n- Potential revenue loss\n- High support volume\n\nThis started happening about 30 minutes ago. Can you investigate immediately? We need to get this resolved ASAP.\n\nThanks,\nEmma\n\nEmma Thompson\nSupport Lead",
      receivedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
      labels: [
        {
          id: 'label-16',
          name: 'Bug',
          color: '#dc2626',
          gmailLabelId: 'gmail-bug-label'
        },
        {
          id: 'label-17',
          name: 'Critical',
          color: '#991b1b',
          gmailLabelId: 'gmail-critical-label'
        },
        {
          id: 'label-18',
          name: 'Support',
          color: '#7c2d12',
          gmailLabelId: 'gmail-support-label'
        },
        {
          id: 'label-19',
          name: 'Payment',
          color: '#059669',
          gmailLabelId: 'gmail-payment-label'
        }
      ]
    },
  }
];

/**
 * Mock data filtered by status for testing specific scenarios
 */
export const mockQueueByStatus = {
  'needs-attention': mockQueueItems.filter(item => item.status === 'needs-attention'),
  'auto-approved': mockQueueItems.filter(item => item.status === 'auto-approved'),
  'all': mockQueueItems,
};

/**
 * Mock data with different confidence levels for testing UI states
 */
export const mockQueueByConfidence = {
  high: mockQueueItems.filter(item => item.confidence >= 90),
  medium: mockQueueItems.filter(item => item.confidence >= 70 && item.confidence < 90),
  low: mockQueueItems.filter(item => item.confidence < 70),
  all: mockQueueItems,
};