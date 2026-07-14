import { z } from 'zod';

/**
 * Zod validation middleware factory
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {'body'|'query'|'params'} source - Where to pull data from
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    // Attach parsed (sanitized) data back to request
    req[source] = result.data;
    next();
  };
}
