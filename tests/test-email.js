#!/usr/bin/env node

/**
 * Test Email Simulator
 * 
 * This script sends test emails to the /api/test-email endpoint
 * to simulate incoming emails and test the email processing pipeline.
 * 
 * Usage: node test-email.js
 */

const BASE_URL = 'http://localhost:3000';

const testEmails = [
  {
    from: 'sarah.johnson@techcorp.com',
    subject: 'Q4 Budget Review Meeting',
    body: `Hi there,

I hope this email finds you well. I wanted to schedule a meeting to discuss the Q4 budget allocations for our upcoming projects.

Could we meet sometime next week? I'm available Tuesday afternoon or Thursday morning. The meeting should take about an hour.

Please let me know what works best for your schedule.

Best regards,
Sarah Johnson
Finance Director
TechCorp Inc.`
  },
  {
    from: 'mike.davis@startup.io',
    subject: 'Partnership Opportunity',
    body: `Hello,

I'm reaching out regarding a potential partnership opportunity between our companies.

We've been following your work in the AI space and believe there could be significant synergy between our platforms. Our startup has developed an innovative data analytics tool that could complement your existing offerings.

Would you be interested in a brief call to explore this further? I'm available this week and next.

Looking forward to hearing from you.

Best,
Mike Davis
Co-founder, Startup.io`
  },
  {
    from: 'jennifer.lee@consulting.com',
    subject: 'Project Update and Next Steps',
    body: `Hi,

Quick update on the implementation project:

✅ Phase 1: Complete
✅ Phase 2: 80% complete (finishing this week)
🔄 Phase 3: Starting next Monday

We're slightly ahead of schedule, which is great news! The team has been working efficiently and we've resolved most of the technical challenges we anticipated.

Next steps:
1. Complete Phase 2 testing by Friday
2. Begin Phase 3 development on Monday
3. Schedule stakeholder review for end of month

Any questions or concerns, please let me know.

Thanks,
Jennifer Lee
Senior Consultant`
  },
  {
    from: 'alex.rivera@university.edu',
    subject: 'Research Collaboration Proposal',
    body: `Dear colleague,

I hope you're doing well. I'm writing to propose a research collaboration that I think could be mutually beneficial.

I'm currently working on a project involving machine learning applications in natural language processing, and I believe your expertise in conversational AI would be invaluable.

The research would focus on:
- Improving context understanding in AI conversations
- Developing better training methodologies
- Publishing findings in top-tier conferences

Would you be interested in discussing this further? I'd be happy to share more details about the project scope and potential funding opportunities.

Best regards,
Dr. Alex Rivera
Computer Science Department
University Research Institute`
  }
];

async function sendTestEmail(email) {
  try {
    console.log(`📧 Sending test email from ${email.from}...`);
    
    const response = await fetch(`${BASE_URL}/api/test-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': process.env.AUTH_COOKIE || ''
      },
      body: JSON.stringify(email)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log(`✅ Success: ${result.message}`);
      console.log(`   Email ID: ${result.email.id}`);
      console.log(`   Subject: "${result.email.subject}"`);
      console.log(`   From: ${result.email.from}`);
      console.log('');
    } else {
      console.log(`❌ Error: ${result.error}`);
      if (result.details) {
        console.log(`   Details: ${result.details}`);
      }
      console.log('');
    }
    
    return response.ok;
  } catch (error) {
    console.error(`❌ Network error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Email Testing Script Started');
  console.log('================================');
  console.log('');
  
  console.log('ℹ️  Note: Make sure you are signed in to the app at http://localhost:3000');
  console.log('ℹ️  This script will simulate incoming emails for testing purposes.');
  console.log('');
  
  let successCount = 0;
  
  for (const email of testEmails) {
    const success = await sendTestEmail(email);
    if (success) successCount++;
    
    // Wait 1 second between emails
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('================================');
  console.log(`📊 Results: ${successCount}/${testEmails.length} emails sent successfully`);
  
  if (successCount > 0) {
    console.log('');
    console.log('🎉 Test emails sent! You should see them in your queue at:');
    console.log('   http://localhost:3000');
    console.log('');
    console.log('💡 What to do next:');
    console.log('   1. Go to the Queue page');
    console.log('   2. Click "Generate Reply" on any email');
    console.log('   3. Test the Approve, Edit, and Reject functionality');
    console.log('   4. Check the full email processing pipeline!');
  } else {
    console.log('');
    console.log('❌ No emails were sent successfully.');
    console.log('💡 Troubleshooting:');
    console.log('   1. Make sure the development server is running (npm run dev)');
    console.log('   2. Make sure you are signed in at http://localhost:3000');
    console.log('   3. Check the server logs for any errors');
  }
}

// Run the script
main().catch(console.error); 