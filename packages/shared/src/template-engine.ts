/**
 * Template interpolation engine for email templates.
 * Works in both Node.js and browser environments.
 *
 * Supports {{variableName}} patterns with HTML entity escaping
 * to prevent XSS when rendering variable values into HTML templates.
 */

/** Characters that need HTML entity escaping */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_ESCAPE_REGEX = /[&<>"']/g;

/**
 * Escape HTML special characters in a string to prevent XSS.
 * Converts &, <, >, ", ' to their HTML entity equivalents.
 */
export function escapeHtml(str: string): string {
  return str.replace(HTML_ESCAPE_REGEX, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

/**
 * Regex to match {{variableName}} patterns.
 * Variable names: letters, digits, underscores, dots (for nested paths).
 * Allows optional whitespace inside braces: {{ nombre }} is valid.
 */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

/**
 * Extract unique variable names from a template string.
 * Scans for all {{variableName}} occurrences and returns deduplicated names.
 *
 * @param template - Template string containing {{variable}} placeholders
 * @returns Array of unique variable names found in the template
 *
 * @example
 * extractVariableNames('Hola {{nombre}}, tu propiedad es {{propiedad}}')
 * // => ['nombre', 'propiedad']
 */
export function extractVariableNames(template: string): string[] {
  const names = new Set<string>();
  let match: RegExpExecArray | null;

  // Reset regex state for each call
  const regex = new RegExp(VARIABLE_PATTERN.source, VARIABLE_PATTERN.flags);

  while ((match = regex.exec(template)) !== null) {
    names.add(match[1]);
  }

  return Array.from(names);
}

/**
 * Render a template by replacing {{variableName}} placeholders with provided values.
 *
 * - All variable values are HTML-escaped before interpolation to prevent XSS
 * - Unresolved variables (not present in the values map) are left as-is
 * - Whitespace inside braces is normalized: {{ nombre }} matches 'nombre'
 *
 * @param template - Template string with {{variable}} placeholders
 * @param values - Map of variable names to their string values
 * @returns The rendered template with variables replaced
 *
 * @example
 * renderTemplate('Hola {{nombre}}', { nombre: 'Juan' })
 * // => 'Hola Juan'
 *
 * renderTemplate('Price: {{precio}}', { precio: '<script>alert(1)</script>' })
 * // => 'Price: &lt;script&gt;alert(1)&lt;/script&gt;'
 *
 * renderTemplate('{{known}} and {{unknown}}', { known: 'yes' })
 * // => 'yes and {{unknown}}'
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  const regex = new RegExp(VARIABLE_PATTERN.source, VARIABLE_PATTERN.flags);

  return template.replace(regex, (fullMatch, variableName: string) => {
    if (variableName in values) {
      return escapeHtml(values[variableName]);
    }
    // Leave unresolved variables as-is for preview display
    return fullMatch;
  });
}

/**
 * Render a template by replacing {{variableName}} placeholders with provided values.
 *
 * Unlike renderTemplate(), this does NOT HTML-escape values — suitable for
 * plain-text targets such as DOCX paragraphs, PDF text runs, and CSV exports
 * where HTML entities would appear as literal ampersand-sequences.
 *
 * - Unresolved variables (not present in the values map) are left as-is
 * - Whitespace inside braces is normalized: {{ nombre }} matches 'nombre'
 *
 * @param template - Template string with {{variable}} placeholders
 * @param values - Map of variable names to their string values
 * @returns The rendered template with variables replaced (no escaping)
 *
 * @example
 * renderTemplatePlain('Hola {{nombre}}', { nombre: 'Juan & María' })
 * // => 'Hola Juan & María'
 */
export function renderTemplatePlain(
  template: string,
  values: Record<string, string>,
): string {
  const regex = new RegExp(VARIABLE_PATTERN.source, VARIABLE_PATTERN.flags);

  return template.replace(regex, (fullMatch, variableName: string) => {
    if (variableName in values) {
      return values[variableName];
    }
    return fullMatch;
  });
}
