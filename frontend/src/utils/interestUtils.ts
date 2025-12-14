/* eslint-disable security/detect-object-injection -- Safe object access with predefined interest keys */
import { type TFunction } from 'i18next';

// Mapping between English display names and translation keys
export const INTEREST_KEY_MAP: { [key: string]: string } = {
  'Travel & Adventure': 'travel_adventure',
  'Food & Dining': 'food_dining',
  'Health & Fitness': 'health_fitness',
  'Technology': 'technology',
  'Reading & Books': 'reading_books',
  'Music & Entertainment': 'music_entertainment',
  'Sports & Recreation': 'sports_recreation',
  'Art & Culture': 'art_culture',
  'Photography': 'photography',
  'Nature & Outdoors': 'nature_outdoors',
  'Fashion & Beauty': 'fashion_beauty',
  'Business & Finance': 'business_finance',
  'Education & Learning': 'education_learning',
  'Family & Relationships': 'family_relationships',
  'Gaming': 'gaming',
  'Cooking & Baking': 'cooking_baking',
  'Movies & TV': 'movies_tv',
  'Volunteering': 'volunteering',
  'Shopping': 'shopping',
  'Home & Garden': 'home_garden'
};

// Reverse mapping for translation key to English display name
export const INTEREST_REVERSE_MAP: { [key: string]: string } = Object.entries(INTEREST_KEY_MAP).reduce(
  (acc, [englishName, key]) => {
    acc[key] = englishName;
    return acc;
  },
  {} as { [key: string]: string }
);

// Get all interest options with translations
export function getInterestOptions(t: TFunction): { key: string; displayName: string; translatedName: string }[] {
  return Object.entries(INTEREST_KEY_MAP).map(([englishName, key]) => ({
    key,
    displayName: englishName, // This is what gets stored in the database
    translatedName: t(`profile.interestOptions.${key}`)
  }));
}

// Get translated name for a stored interest (stored in English)
export function getTranslatedInterest(interest: string, t: TFunction): string {
  const key = INTEREST_KEY_MAP[interest];
  if (key) {
    return t(`profile.interestOptions.${key}`);
  }
  // Fallback to the original value if no translation key found
  return interest;
}

// Get translation key for English interest name
export function getInterestKey(englishName: string): string | undefined {
  return INTEREST_KEY_MAP[englishName];
}

// Get English name from translation key
export function getEnglishInterestName(key: string): string | undefined {
  return INTEREST_REVERSE_MAP[key];
}