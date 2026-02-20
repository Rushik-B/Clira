/**
 * Text repair functions for AI SDK generateObject calls.
 *
 * IMPORTANT:
 * - This module does NOT attempt to "clean" chatty model output (no code-fence stripping,
 *   no "extract first JSON" heuristics). If the model returns non-JSON, we return null
 *   and let the AI SDK error visibly.
 * - The only supported repair is deterministic truncation of already-valid JSON strings
 *   to satisfy known schema length limits.
 */

/**
 * Create a repair function that truncates overly long text fields to prevent schema validation errors
 */
export function createSchemaRepairFunction() {
  return async ({ text, error }: { text: string; error: any }): Promise<string | null> => {
    try {
      const raw = typeof text === 'string' ? text.trim() : String(text);

      // Only proceed if the output is already valid JSON.
      // We intentionally avoid "extract/strip" heuristics to keep failures visible.
      const parsed = JSON.parse(raw);
      
      // Always apply truncation to prevent schema violations
      const truncateObject = (obj: any): any => {
        if (typeof obj !== 'object' || obj === null) return obj;
        
        if (Array.isArray(obj)) {
          return obj.map(truncateObject);
        }
        
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') {
            let truncated = false;
            // Apply field-specific length limits based on our schemas
            switch (key) {
              case 'reply':
                if (value.length > 4000) {
                  result[key] = value.substring(0, 3997) + '...';
                  truncated = true;
                } else {
                  result[key] = value;
                }
                break;
              case 'reasoning':
                if (value.length > 500) {
                  result[key] = value.substring(0, 497) + '...';
                  truncated = true;
                } else {
                  result[key] = value;
                }
                break;
              case 'metaPrompt':
                if (value.length > 300) {
                  result[key] = value.substring(0, 297) + '...';
                  truncated = true;
                } else {
                  result[key] = value;
                }
                break;
              case 'description':
                if (value.length > 200) {
                  result[key] = value.substring(0, 197) + '...';
                  truncated = true;
                } else {
                  result[key] = value;
                }
                break;
              case 'name':
                if (value.length > 50) {
                  result[key] = value.substring(0, 47) + '...';
                  truncated = true;
                } else {
                  result[key] = value;
                }
                break;
              case 'recommendedApproach':
                if (value.length > 200) {
                  result[key] = value.substring(0, 197) + '...';
                  truncated = true;
                } else {
                  result[key] = value;
                }
                break;
              // Email mapping specific constraints
              case 'suggestedAction':
                if (value.length > 100) {
                  result[key] = value.substring(0, 97) + '...';
                  truncated = true;
                } else {
                  result[key] = value;
                }
                break;
              default:
                result[key] = value;
            }
          } else {
            result[key] = truncateObject(value);
          }
        }
        return result;
      };
      
      const repaired = truncateObject(parsed);
      const repairedJson = JSON.stringify(repaired);
      return repairedJson;
    } catch (e) {
      // If JSON parsing fails, return null to let AI SDK handle it
      return null;
    }
  };
}