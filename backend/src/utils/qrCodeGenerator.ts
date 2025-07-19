import QRCode from 'qrcode';
import { logger } from './logger.js';

export interface QRCodeData {
  type: 'coupon_redemption' | 'survey_access' | 'loyalty_points';
  id: string;
  code?: string;
  metadata?: Record<string, any>;
}

export interface QRCodeOptions {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  margin?: number;
  scale?: number;
  width?: number;
  color?: {
    dark?: string;
    light?: string;
  };
}

export class QRCodeGenerator {
  private static defaultOptions: QRCodeOptions = {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  };

  /**
   * Generate QR code as data URL
   */
  static async generateDataURL(
    data: QRCodeData, 
    options: QRCodeOptions = {}
  ): Promise<string> {
    try {
      const qrOptions = { ...this.defaultOptions, ...options };
      const jsonData = JSON.stringify(data);
      
      const dataURL = await QRCode.toDataURL(jsonData, qrOptions);
      
      logger.debug(`QR code generated for type: ${data.type}`);
      return dataURL;
    } catch (error) {
      logger.error('Error generating QR code data URL:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Generate QR code as SVG string
   */
  static async generateSVG(
    data: QRCodeData, 
    options: QRCodeOptions = {}
  ): Promise<string> {
    try {
      const qrOptions = { ...this.defaultOptions, ...options };
      const jsonData = JSON.stringify(data);
      
      const svg = await QRCode.toString(jsonData, {
        type: 'svg',
        ...qrOptions
      });
      
      logger.debug(`QR code SVG generated for type: ${data.type}`);
      return svg;
    } catch (error) {
      logger.error('Error generating QR code SVG:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Generate QR code as buffer (for file storage)
   */
  static async generateBuffer(
    data: QRCodeData, 
    options: QRCodeOptions = {}
  ): Promise<Buffer> {
    try {
      const qrOptions = { ...this.defaultOptions, ...options };
      const jsonData = JSON.stringify(data);
      
      const buffer = await QRCode.toBuffer(jsonData, qrOptions);
      
      logger.debug(`QR code buffer generated for type: ${data.type}`);
      return buffer;
    } catch (error) {
      logger.error('Error generating QR code buffer:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Validate and parse QR code data
   */
  static parseQRCodeData(qrString: string): QRCodeData {
    try {
      const data = JSON.parse(qrString);
      
      if (!data.type || !data.id) {
        throw new Error('Invalid QR code format');
      }
      
      return data as QRCodeData;
    } catch (error) {
      logger.error('Error parsing QR code data:', error);
      throw new Error('Invalid QR code data');
    }
  }

  /**
   * Generate coupon QR code
   */
  static async generateCouponQR(
    couponId: string, 
    couponCode: string,
    options: QRCodeOptions = {}
  ): Promise<string> {
    const data: QRCodeData = {
      type: 'coupon_redemption',
      id: couponId,
      code: couponCode,
      metadata: {
        timestamp: new Date().toISOString()
      }
    };
    
    return this.generateDataURL(data, options);
  }

  /**
   * Generate survey QR code
   */
  static async generateSurveyQR(
    surveyId: string,
    surveyCode: string,
    options: QRCodeOptions = {}
  ): Promise<string> {
    const data: QRCodeData = {
      type: 'survey_access',
      id: surveyId,
      code: surveyCode,
      metadata: {
        timestamp: new Date().toISOString()
      }
    };
    
    return this.generateDataURL(data, options);
  }

  /**
   * Generate loyalty points QR code
   */
  static async generateLoyaltyQR(
    customerId: string,
    pointsAmount: number,
    options: QRCodeOptions = {}
  ): Promise<string> {
    const data: QRCodeData = {
      type: 'loyalty_points',
      id: customerId,
      metadata: {
        points: pointsAmount,
        timestamp: new Date().toISOString()
      }
    };
    
    return this.generateDataURL(data, options);
  }

  /**
   * Batch generate QR codes
   */
  static async batchGenerate(
    items: Array<{
      data: QRCodeData;
      options?: QRCodeOptions;
    }>
  ): Promise<string[]> {
    try {
      const promises = items.map(item => 
        this.generateDataURL(item.data, item.options)
      );
      
      const results = await Promise.all(promises);
      
      logger.info(`Batch generated ${results.length} QR codes`);
      return results;
    } catch (error) {
      logger.error('Error in batch QR code generation:', error);
      throw new Error('Failed to generate QR codes in batch');
    }
  }

  /**
   * Generate QR code with custom branding
   */
  static async generateBrandedQR(
    data: QRCodeData,
    brandOptions: {
      logo?: string;
      brandColor?: string;
      backgroundColor?: string;
    } = {},
    options: QRCodeOptions = {}
  ): Promise<string> {
    const qrOptions: QRCodeOptions = {
      ...this.defaultOptions,
      ...options,
      color: {
        dark: brandOptions.brandColor || '#1f2937',
        light: brandOptions.backgroundColor || '#ffffff'
      }
    };
    
    return this.generateDataURL(data, qrOptions);
  }
}