import { beforeEach, describe, expect, test, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  prisma: {
    emailMapping: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks.prisma,
}));

vi.mock('@/lib/services/utils/queues', () => ({
  emailMappingQueue: {
    add: vi.fn(),
  },
}));

vi.mock('@/lib/services/onboarding-services/utils/queueStatus', () => ({
  getJobStatus: vi.fn(),
}));

const { EmailMappingService } = await import('@/lib/services/onboarding-services/emailMappingService');

function buildDbMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping-1',
    userId: 'user-1',
    mailboxId: null,
    labelId: 'label-1',
    emailAddress: 'sender@example.com',
    domain: null,
    isActive: true,
    mappingType: 'EMAIL',
    confidence: 0.99,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    label: {
      name: 'Priority',
      color: '#fff',
      mailboxId: null,
    },
    mailbox: null,
    ...overrides,
  };
}

describe('EmailMappingService.findMappingForEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('falls back to legacy user-global exact mappings when mailbox-specific mapping is missing', async () => {
    prismaMocks.prisma.emailMapping.findFirst.mockImplementation(async ({ where }) => {
      if (where.mappingType === 'EMAIL' && where.mailboxId === 'mailbox-1') {
        return null;
      }

      if (where.mappingType === 'EMAIL' && where.mailboxId === null) {
        return buildDbMapping();
      }

      return null;
    });

    const service = new EmailMappingService();
    const result = await service.findMappingForEmail('user-1', 'Sender@Example.com', 'mailbox-1');

    expect(result.matchType).toBe('exact');
    expect(result.mapping?.labelName).toBe('Priority');
    expect(result.mapping?.mailboxId).toBeUndefined();
    expect(prismaMocks.prisma.emailMapping.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          mailboxId: 'mailbox-1',
          mappingType: 'EMAIL',
          emailAddress: { equals: 'Sender@Example.com', mode: 'insensitive' },
        }),
      }),
    );
    expect(prismaMocks.prisma.emailMapping.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          mailboxId: null,
          mappingType: 'EMAIL',
          emailAddress: { equals: 'Sender@Example.com', mode: 'insensitive' },
        }),
      }),
    );
  });

  test('falls back to legacy user-global domain mappings when mailbox-specific lookups miss', async () => {
    prismaMocks.prisma.emailMapping.findFirst.mockImplementation(async ({ where }) => {
      if (where.mappingType === 'EMAIL') {
        return null;
      }

      if (where.mappingType === 'DOMAIN' && where.mailboxId === 'mailbox-1') {
        return null;
      }

      if (where.mappingType === 'DOMAIN' && where.mailboxId === null) {
        return buildDbMapping({
          id: 'mapping-domain-1',
          emailAddress: '*@example.com',
          domain: '@example.com',
          mappingType: 'DOMAIN',
        });
      }

      return null;
    });

    const service = new EmailMappingService();
    const result = await service.findMappingForEmail('user-1', 'sender@example.com', 'mailbox-1');

    expect(result.matchType).toBe('domain');
    expect(result.mapping?.domain).toBe('@example.com');
    expect(prismaMocks.prisma.emailMapping.findFirst).toHaveBeenCalledTimes(4);
    expect(prismaMocks.prisma.emailMapping.findFirst).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          mailboxId: null,
          mappingType: 'DOMAIN',
          domain: { equals: '@example.com', mode: 'insensitive' },
        }),
      }),
    );
  });

  test('prefers mailbox-specific exact mappings over legacy user-global mappings', async () => {
    prismaMocks.prisma.emailMapping.findFirst.mockImplementation(async ({ where }) => {
      if (where.mappingType === 'EMAIL' && where.mailboxId === 'mailbox-1') {
        return buildDbMapping({
          id: 'mapping-mailbox-1',
          mailboxId: 'mailbox-1',
          mailbox: { emailAddress: 'team@example.com' },
          label: {
            name: 'Mailbox Label',
            color: '#000',
            mailboxId: 'mailbox-1',
          },
        });
      }

      if (where.mappingType === 'EMAIL' && where.mailboxId === null) {
        return buildDbMapping({
          id: 'mapping-global-1',
          label: {
            name: 'Global Label',
            color: '#111',
            mailboxId: null,
          },
        });
      }

      return null;
    });

    const service = new EmailMappingService();
    const result = await service.findMappingForEmail('user-1', 'sender@example.com', 'mailbox-1');

    expect(result.matchType).toBe('exact');
    expect(result.mapping?.id).toBe('mapping-mailbox-1');
    expect(result.mapping?.labelName).toBe('Mailbox Label');
    expect(prismaMocks.prisma.emailMapping.findFirst).toHaveBeenCalledTimes(1);
  });
});
