/**
 * Date formatting utilities for consistent dd/mm/yyyy format across the application
 * European/International date format: 31/12/2025 = December 31st, 2025
 */

export const formatDateToDDMMYYYY = (date: Date | string | null | undefined): string | null => {
  if (!date) {return null;}
  
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      return null;
    }

    // Format as dd/mm/yyyy using European locale
    return dateObj.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch (error) {
    console.warn('Error formatting date:', error);
    return null;
  }
};

export const formatDateTimeToEuropean = (date: Date | string | null | undefined): string | null => {
  if (!date) {return null;}
  
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      return null;
    }

    // Format as dd/mm/yyyy hh:mm using European locale
    return dateObj.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (error) {
    console.warn('Error formatting datetime:', error);
    return null;
  }
};

/**
 * Format expiry date with relative text for UI display
 * Returns dd/mm/yyyy for dates more than 7 days away
 * Returns relative text for sooner dates (today, tomorrow, etc.)
 */
export const formatExpiryDateWithRelative = (
  date: Date | string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null => {
  if (!date) {return null;}
  
  try {
    const expiryDate = typeof date === 'string' ? new Date(date) : date;
    
    // Check if date is valid
    if (isNaN(expiryDate.getTime())) {
      return null;
    }

    const now = new Date();
    const timeDiff = expiryDate.getTime() - now.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

    if (daysDiff < 0) {return t('coupons.expired');}
    if (daysDiff === 0) {return t('coupons.expiresToday');}
    if (daysDiff === 1) {return t('coupons.expiresTomorrow');}
    if (daysDiff <= 7) {return t('coupons.expiresInDays', { count: daysDiff });}

    // For dates more than 7 days away, use dd/mm/yyyy format
    return formatDateToDDMMYYYY(expiryDate);
  } catch (error) {
    console.warn('Error formatting expiry date:', error);
    return null;
  }
};

/**
 * Validate if a date string is in dd/mm/yyyy format
 */
export const isValidDDMMYYYYFormat = (dateString: string): boolean => {
  const ddmmyyyyRegex = /^\d{2}\/\d{2}\/\d{4}$/;
  return ddmmyyyyRegex.test(dateString);
};

/**
 * Parse dd/mm/yyyy string to Date object
 */
export const parseDDMMYYYY = (dateString: string): Date | null => {
  if (!isValidDDMMYYYYFormat(dateString)) {
    return null;
  }

  const [day, month, year] = dateString.split('/').map(Number);
  const date = new Date(year!, month! - 1, day!); // month is 0-indexed in Date constructor

  // Validate the date is correct (handles invalid dates like 31/02/2025)
  if (date.getDate() !== day || date.getMonth() !== month! - 1 || date.getFullYear() !== year) {
    return null;
  }
  
  return date;
};