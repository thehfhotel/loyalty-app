/**
 * Date formatting utilities for consistent dd/mm/yyyy format across the backend
 * European/International date format: 31/12/2025 = December 31st, 2025
 */

import { logger } from './logger';

export const formatDateToDDMMYYYY = (date: Date | string | null | undefined): string | null => {
  if (!date) return null;
  
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
    logger.warn('Error formatting date:', error);
    return null;
  }
};

export const formatDateTimeToEuropean = (date: Date | string | null | undefined): string | null => {
  if (!date) return null;
  
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
    logger.warn('Error formatting datetime:', error);
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
  const date = new Date(year, month - 1, day); // month is 0-indexed in Date constructor
  
  // Validate the date is correct (handles invalid dates like 31/02/2025)
  if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
    return null;
  }
  
  return date;
};