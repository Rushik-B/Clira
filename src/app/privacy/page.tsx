import React from 'react';
import { Metadata } from 'next';
import { SUPPORT_EMAIL } from '@/lib/publicConfig';

export const metadata: Metadata = {
  title: 'Privacy Policy - Clira',
  description: 'Privacy Policy for Clira AI Email Assistant',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Privacy Policy</h1>
          <p className="text-lg text-gray-600">
            Effective Date: June 15, 2025 | Last Updated: June 15, 2025
          </p>
        </div>

        {/* Content */}
        <div className="prose prose-lg max-w-none">
          {/* Introduction */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Introduction</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Welcome to Clira ("we," "our," or "us"). Clira is an AI-powered email assistant that helps you manage and respond to your emails more efficiently. This Privacy Policy explains how we handle your information when you use our service.
            </p>
            <p className="text-gray-700 leading-relaxed">
              By using Clira, you agree to the practices described in this Privacy Policy. If you do not agree with our policies and practices, do not use our service.
            </p>
          </section>

          {/* Information We Collect */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Information We Collect</h2>
            <h3 className="text-xl font-medium text-gray-800 mb-3">2.1 Information You Provide</h3>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li>Account information (name, email address) when you sign up through Google OAuth</li>
              <li>Feedback and communications when you contact us or submit feedback for evaluation</li>
            </ul>
            <h3 className="text-xl font-medium text-gray-800 mb-3">2.2 Gmail Data We Access</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              With your explicit consent, Clira accesses your Gmail data <strong>in memory only</strong> to provide AI email assistant services. <strong>Clira does not store, persist, or retain any of your email content, metadata, or Gmail data on its servers or databases.</strong>
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li><strong>Email Content:</strong> Processed in memory only to generate responses. Not stored or logged.</li>
              <li><strong>Email Metadata:</strong> Used in memory for context. Not stored or logged.</li>
              <li><strong>Email Composition:</strong> Clira sends emails on your behalf only when you approve AI-generated responses. No content is stored.</li>
              <li><strong>Gmail Labels and Threads:</strong> Accessed in memory for context. Not stored or logged.</li>
            </ul>
            <h3 className="text-xl font-medium text-gray-800 mb-3">2.3 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li>Basic usage data and analytics about how you interact with our service (not email content)</li>
              <li>Device information and browser type</li>
              <li>IP address and general location information</li>
              <li>Log files and error reports (never containing email content)</li>
            </ul>
          </section>

          {/* How We Use Your Information */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. How We Use Your Information</h2>
            <p className="text-gray-700 leading-relaxed mb-4">We use your information to:</p>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li><strong>Provide AI Email Assistance:</strong> Analyze your email patterns <strong>in memory only</strong> to generate personalized response suggestions</li>
              <li><strong>Send Emails:</strong> Send approved responses on your behalf through Gmail (no content is stored)</li>
              <li><strong>Improve Our Service:</strong> Analyze general usage patterns to enhance our AI models and user experience (never using your email content)</li>
              <li><strong>Provide Support:</strong> Respond to your inquiries and provide customer support</li>
              <li><strong>Security:</strong> Monitor for suspicious activity and protect against fraud</li>
              <li><strong>Legal Compliance:</strong> Comply with applicable laws and regulations</li>
            </ul>
          </section>

          {/* Google API Services */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Google API Services</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Clira's use and transfer of information received from Google APIs adheres to the{' '}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                Google API Services User Data Policy
              </a>, including the Limited Use requirements.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              Clira only requests the minimum Gmail permissions necessary to provide our service. <strong>No email data is ever stored or persisted.</strong>
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li><strong>Gmail Read:</strong> To analyze your email communication patterns in memory only</li>
              <li><strong>Gmail Send:</strong> To send approved responses on your behalf</li>
              <li><strong>Gmail Modify:</strong> To manage email threads and labels in memory only</li>
            </ul>
          </section>

          {/* Data Storage and Security */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Data Storage and Security</h2>
            <h3 className="text-xl font-medium text-gray-800 mb-3">5.1 Data Storage</h3>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li><strong>Clira does NOT store any of your emails, email content, or Gmail data.</strong></li>
              <li><strong>The only data stored by Clira is feedback you explicitly submit for evaluation purposes.</strong></li>
              <li>Account and authentication data is stored securely for login purposes only.</li>
            </ul>
            <h3 className="text-xl font-medium text-gray-800 mb-3">5.2 Security Measures</h3>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li>All data transmission is encrypted using HTTPS/TLS</li>
              <li>Database connections are encrypted and secured</li>
              <li>Access to your data is restricted to authorized personnel only</li>
              <li>We implement industry-standard security practices</li>
              <li>Regular security audits and monitoring</li>
            </ul>
          </section>

          {/* Data Sharing */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Data Sharing and Disclosure</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We do not sell, trade, or otherwise transfer your personal information to third parties, except in the following circumstances:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li><strong>Service Providers:</strong> We may share data with trusted third-party services that help us operate our platform (e.g., Google Cloud, Heroku). <strong>No email content is ever shared or stored.</strong></li>
              <li><strong>Legal Requirements:</strong> We may disclose information if required by law or to protect our rights</li>
              <li><strong>Business Transfers:</strong> In the event of a merger or acquisition, your information may be transferred</li>
              <li><strong>With Your Consent:</strong> We may share information with your explicit consent</li>
            </ul>
          </section>

          {/* AI and Machine Learning */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. AI and Machine Learning</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Clira uses artificial intelligence to analyze your emails and generate responses <strong>in memory only</strong>:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li>We use Google's Gemini AI models to process your email content in memory only</li>
              <li>Your email data is <strong>never stored or used to train general AI models</strong></li>
              <li>All AI processing is done securely and in accordance with this privacy policy</li>
              <li>The only data stored is user-submitted feedback for evaluation</li>
            </ul>
          </section>

          {/* Your Rights */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Your Rights and Choices</h2>
            <p className="text-gray-700 leading-relaxed mb-4">You have the following rights regarding your data:</p>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li><strong>Access:</strong> Request access to your personal data</li>
              <li><strong>Correction:</strong> Request correction of inaccurate data</li>
              <li><strong>Deletion:</strong> Request deletion of your data</li>
              <li><strong>Portability:</strong> Request a copy of your data in a portable format</li>
              <li><strong>Revoke Consent:</strong> Revoke Gmail access permissions at any time through your Google Account settings</li>
              <li><strong>Account Deletion:</strong> Delete your Clira account and all associated data</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              To exercise these rights, please contact us at the information provided below.
            </p>
          </section>

          {/* Data Retention */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Data Retention</h2>
            <ul className="list-disc pl-6 mb-4 text-gray-700">
              <li>Clira does <strong>not</strong> retain your email data. All email processing is done in memory and not persisted.</li>
              <li>You can request deletion of your feedback or account data at any time</li>
              <li>When you delete your account, we will delete all associated data within 30 days</li>
              <li>Some data may be retained for legal compliance or security purposes</li>
            </ul>
          </section>

          {/* International Transfers */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. International Data Transfers</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Your data may be transferred to and processed in countries other than your own. We ensure that such transfers comply with applicable data protection laws and implement appropriate safeguards.
            </p>
          </section>

          {/* Children's Privacy */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">11. Children's Privacy</h2>
            <p className="text-gray-700 leading-relaxed">
              Clira is not intended for use by children under 13 years of age. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal information from a child under 13, we will take steps to delete such information.
            </p>
          </section>

          {/* Changes to Privacy Policy */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">12. Changes to This Privacy Policy</h2>
            <p className="text-gray-700 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date. You are advised to review this Privacy Policy periodically for any changes.
            </p>
          </section>

          {/* Contact Information */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">13. Contact Us</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              If you have any questions about this Privacy Policy or our data practices, please contact us:
            </p>
            <div className="bg-gray-50 p-6 rounded-lg">
              <p className="text-gray-700 mb-2"><strong>Email:</strong> {SUPPORT_EMAIL}</p>
              <p className="text-gray-700"><strong>Website:</strong> https://tryclira.com</p>
            </div>
          </section>

          {/* Compliance */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">14. Compliance</h2>
            <p className="text-gray-700 leading-relaxed">
              This Privacy Policy is designed to comply with applicable privacy laws including GDPR, CCPA, and other relevant regulations. We are committed to protecting your privacy and handling your data responsibly.
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-500">
            © 2025 Clira. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
} 
