import crypto from 'node:crypto';

export function createContentReferenceId(params: {
  sourceKind: string;
  locator: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(`${params.sourceKind}:${params.locator}`)
    .digest('hex');
}
