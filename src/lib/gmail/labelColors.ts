export const GMAIL_LABEL_COLORS: readonly string[] = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#efefef', '#f3f3f3', '#ffffff',
  '#fb4c2f', '#ffad47', '#fad165', '#cc3a21', '#eaa041', '#f2c960', '#ac2b16', '#cf8933',
  '#d5ae49', '#822111', '#a46a21', '#aa8831', '#ff7537', '#ffad46', '#16a766', '#43d692',
  '#149e60', '#3dc789', '#0b804b', '#2a9c68', '#076239', '#1a764d', '#16a765', '#42d692',
  '#44b984', '#68dfa9', '#4a86e8', '#6d9eeb', '#3c78d8', '#285bac', '#1c4587', '#4986e7',
  '#2da2bb', '#a479e2', '#b694e8', '#8e63ce', '#653e9b', '#41236d', '#3d188e', '#b99aff',
  '#f691b3', '#f7a7c0', '#e07798', '#b65775', '#83334c', '#994a64', '#f691b2', '#f6c5be',
  '#ffe6c7', '#fef1d1', '#b9e4d0', '#c6f3de', '#c9daf8', '#e4d7f5', '#fcdee8', '#efa093',
  '#ffbc6b', '#fcda83', '#464646', '#e7e7e7', '#0d3472', '#b6cff5', '#0d3b44', '#98d7e4',
  '#e3d7ff', '#711a36', '#fbd3e0', '#8a1c0a', '#f2b2a8', '#7a2e0b', '#ffc8af', '#7a4706',
  '#ffdeb5', '#594c05', '#fbe983', '#684e07', '#fdedc1', '#0b4f30', '#b3efd3', '#04502e',
  '#a2dcc1', '#c2c2c2', '#662e37', '#ebdbde', '#cca6ac', '#094228'
] as const;

const COLOR_SET = new Set(GMAIL_LABEL_COLORS.map((color) => color.toLowerCase()));
const DEFAULT_BACKGROUND = '#4a86e8';

function clampColor(input: string | undefined | null): string {
  if (!input) {
    return DEFAULT_BACKGROUND;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_BACKGROUND;
  }

  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  const normalized = withHash.toLowerCase();
  return COLOR_SET.has(normalized) ? normalized : DEFAULT_BACKGROUND;
}

function getContrastingTextColor(backgroundHex: string): string {
  const hex = backgroundHex.replace('#', '');
  if (hex.length !== 6) {
    return '#ffffff';
  }

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

export function normalizeGmailLabelColor(color: string | undefined | null): {
  backgroundColor: string;
  textColor: string;
} {
  const backgroundColor = clampColor(color);
  const textColor = getContrastingTextColor(backgroundColor);
  return { backgroundColor, textColor };
}

export const DEFAULT_GMAIL_LABEL_COLOR = DEFAULT_BACKGROUND;
