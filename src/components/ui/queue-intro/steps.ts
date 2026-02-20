import type { QueueIntroStep } from './types';



// Importing image sources
const firstImage = '/intro-images/first-image.png';
const lastImage = '/intro-images/last-image.png';

// Importing video sources
const shortcutsVideo = '/intro-videos/shortcuts-latest.mp4';
const acceptVideo = '/intro-videos/accept-latest.mp4';
const rejectVideo = '/intro-videos/reject-latest.mp4';

export const queueIntroSteps: QueueIntroStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Clira',
    description: 'Finish onboarding and step into a focused workspace where only the most important conversations reach you.',
    media: {
      type: 'image',
      src: firstImage,
      alt: 'Illustration welcoming the user to Clira',
    },
  },
  {
    id: 'prioritize',
    title: 'Navigate with Shortcuts',
    description: 'Use keyboard shortcuts to quickly navigate through your queue. Arrow keys to move between emails, Cmd+Enter to send, and more.',
    media: {
      type: 'video',
      src: shortcutsVideo,
      alt: 'Demonstration of keyboard shortcuts for queue navigation',
    },
  },
  {
    id: 'preview',
    title: 'Accept with Confidence',
    description: 'Review and approve AI-generated responses directly from the queue view. One click to send polished replies.',
    media: {
      type: 'video',
      src: acceptVideo,
      alt: 'Demonstration of accepting and sending emails from queue view',
    },
  },
  {
    id: 'approve',
    title: 'Reject & Improve',
    description: 'Reject responses that don\'t meet your standards. Your feedback helps Clira learn and improve future responses.',
    media: {
      type: 'video',
      src: rejectVideo,
      alt: 'Demonstration of rejecting emails and providing feedback for improvement',
    },
  },
  {
    id: 'automate',
    title: 'We\'re just getting started',
    description: 'Set it and let Clira handle the chaos. Clira helps you never worry about emails again.',
    media: {
      type: 'image',
      src: lastImage,
      alt: 'Automation dashboard illustration',
    },
  },
];
