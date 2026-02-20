// Multi-Inbox Mailbox Services
// These utilities provide mailbox-scoped operations for the multi-inbox architecture.

export {
  getMailboxesForUser,
  getMailboxCountForUser,
  hasMailboxesNeedingReconnect,
  type MailboxWithStatus,
} from './getMailboxesForUser'

export {
  getPrimaryMailbox,
  getPrimaryMailboxId,
  getMailboxById,
  getMailboxByEmailAddress,
  type PrimaryMailbox,
} from './getPrimaryMailbox'
