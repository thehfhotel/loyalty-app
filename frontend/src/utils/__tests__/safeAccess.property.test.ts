import fc from 'fast-check';
import { safeGetTranslation, TRANSLATION_KEYS } from '../safeAccess';

describe('safeAccess fuzzing', () => {
  it('only returns values for allowed translation keys', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 20 }), fc.string())),
        fc.string(),
        (entries, key) => {
          const obj: Record<string, string> = Object.create(null);
          for (const [k, v] of entries) {
            obj[k] = v;
          }

          const result = safeGetTranslation(obj, key);
          const isAllowed = TRANSLATION_KEYS.includes(key as typeof TRANSLATION_KEYS[number]);

          return isAllowed ? result === obj[key] : result === undefined;
        }
      )
    );
  });
});
