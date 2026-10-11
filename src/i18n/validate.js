const placeholders = (text) =>
  [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((match) => match[1]);

// Used by verification, not shipped with the game. Logical keys and parameter
// contracts are shared; each language owns its own plural branches.
export function validateMessages(messages, schema, locale) {
  const errors = [];
  const expected = Object.keys(schema);
  for (const code of Object.keys(messages))
    if (!Object.hasOwn(schema, code)) errors.push(`Unexpected message: ${code}`);
  for (const code of expected) {
    const value = messages[code];
    if (value == null) {
      errors.push(`Missing message: ${code}`);
      continue;
    }
    const plural = typeof value === 'object';
    if (plural) {
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      for (const category of categories)
        if (!Object.hasOwn(value, category)) errors.push(`Missing ${category} for ${code}`);
    }
    const variants = plural ? Object.values(value) : [value];
    for (const text of variants) {
      if (typeof text !== 'string' || !text.trim()) {
        errors.push(`Empty message: ${code}`);
        continue;
      }
      const actual = new Set(placeholders(text));
      if (plural) actual.add('count');
      const required = schema[code];
      if (required.length !== actual.size || required.some((param) => !actual.has(param)))
        errors.push(`Parameter mismatch: ${code}`);
    }
  }
  return errors;
}
