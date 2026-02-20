#!/usr/bin/env node

/**
 * Email Filtering Test Script
 * 
 * This script helps debug your email filtering logic by testing different scenarios.
 * Usage: node test-filtering.js
 */

const testEmails = [
  {
    name: "Normal Email from Contact",
    email: {
      from: "john@example.com",
      to: ["your-email@gmail.com"],
      subject: "Let's catch up",
      body: "Hey, how are you doing?"
    }
  },
  {
    name: "Newsletter (should be blocked)",
    email: {
      from: "newsletter@company.com",
      to: ["your-email@gmail.com"],
      subject: "Weekly Newsletter",
      body: "This week's updates...",
      labelIds: ["CATEGORY_PROMOTIONS"]
    }
  },
  {
    name: "No-reply email (should be blocked)",
    email: {
      from: "no-reply@service.com",
      to: ["your-email@gmail.com"],
      subject: "Account Update",
      body: "Your account has been updated"
    }
  },
  {
    name: "CC Only Email (should be blocked)",
    email: {
      from: "team@company.com",
      to: ["someone-else@company.com"],
      cc: ["your-email@gmail.com"],
      subject: "Team Update",
      body: "Weekly team meeting notes"
    }
  }
];

console.log(`🧪 Email Filtering Test Cases\n`);
console.log(`To test these scenarios:`);
console.log(`1. Open your browser and go to your app`);
console.log(`2. Open browser dev tools (F12)`);
console.log(`3. Go to Network tab`);
console.log(`4. For each test case below, make a POST request to /api/debug-filter with the test data\n`);

testEmails.forEach((test, index) => {
  console.log(`📧 Test ${index + 1}: ${test.name}`);
  console.log(`   Fetch request:`);
  console.log(`   fetch('/api/debug-filter', {`);
  console.log(`     method: 'POST',`);
  console.log(`     headers: { 'Content-Type': 'application/json' },`);
  console.log(`     body: JSON.stringify(${JSON.stringify({testEmail: test.email}, null, 6)})`);
  console.log(`   }).then(r => r.json()).then(console.log)\n`);
});

console.log(`🔧 Additional Debugging Tips:`);
console.log(`1. Check your current settings: fetch('/api/settings/email-filters').then(r => r.json()).then(console.log)`);
console.log(`2. Check if you're in onboarding: Look for onboarding overlays on the settings page`);
console.log(`3. Check browser console for filtering logs when emails are processed\n`);

console.log(`⚠️  Common Issues:`);
console.log(`1. Settings not saving: Check network requests for error responses`);
console.log(`2. Onboarding data not reflecting: Clear browser cache and check if preferencesSaved=true`);
console.log(`3. Test emails being filtered: Check if they match hard-coded patterns or user blocklist`); 