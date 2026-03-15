export type EmailMappingRuleLike = {
  mappingType?: string | null;
  emailAddress?: string | null;
  domain?: string | null;
  subjectPattern?: string | null;
};

export function getEmailMappingRuleValue(rule: EmailMappingRuleLike): string {
  switch (rule.mappingType) {
    case 'EMAIL':
      return rule.emailAddress ?? '';
    case 'DOMAIN':
      return rule.domain ?? rule.emailAddress ?? '';
    case 'SUBJECT':
    case 'SUBJECT_CONTAINS':
    case 'SUBJECT_STARTS_WITH':
    case 'SUBJECT_ENDS_WITH':
    case 'SUBJECT_REGEX':
      return rule.subjectPattern ?? '';
    default:
      return rule.emailAddress ?? rule.domain ?? rule.subjectPattern ?? '';
  }
}
