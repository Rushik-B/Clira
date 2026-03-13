import { beforeEach, describe, expect, test, vi } from 'vitest';
import { WhatsAppClient, type WhatsAppWebhookPayload } from '@/lib/services/whatsapp/whatsappClient';

describe('WhatsAppClient.parseWebhookPayload', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-token');
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id');
    vi.stubEnv('WHATSAPP_APP_SECRET', 'app-secret');
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'verify-token');
  });

  test('captures pdf documents from webhook payloads', () => {
    const client = new WhatsAppClient();
    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550000000',
                  phone_number_id: '123',
                },
                contacts: [
                  {
                    profile: { name: 'Rushik' },
                    wa_id: '15551234567',
                  },
                ],
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid-1',
                    timestamp: '1710000000',
                    type: 'document',
                    document: {
                      id: 'doc-1',
                      mime_type: 'application/pdf',
                      filename: 'agenda.pdf',
                      caption: 'Summarize this',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(client.parseWebhookPayload(payload)).toEqual({
      waId: '15551234567',
      senderName: 'Rushik',
      messageId: 'wamid-1',
      text: '',
      timestamp: 1_710_000_000,
      pdfMediaId: 'doc-1',
      pdfMimeType: 'application/pdf',
      pdfFilename: 'agenda.pdf',
      pdfCaption: 'Summarize this',
    });
  });

  test('ignores non-pdf documents', () => {
    const client = new WhatsAppClient();
    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-2',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550000000',
                  phone_number_id: '123',
                },
                contacts: [
                  {
                    profile: { name: 'Rushik' },
                    wa_id: '15551234567',
                  },
                ],
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid-2',
                    timestamp: '1710000001',
                    type: 'document',
                    document: {
                      id: 'doc-2',
                      mime_type: 'text/plain',
                      filename: 'notes.txt',
                      caption: 'Ignore this',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(client.parseWebhookPayload(payload)).toBeNull();
  });
});
