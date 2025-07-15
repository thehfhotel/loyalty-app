const axios = require('axios');
const db = require('../config/database');
const xml2js = require('xml2js');

class PMSService {
  constructor() {
    this.baseURL = process.env.PMS_API_URL;
    this.apiKey = process.env.PMS_API_KEY;
    this.apiClient = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async syncGuestData(guestId = null) {
    try {
      const endpoint = guestId ? `/guests/${guestId}` : '/guests';
      const response = await this.apiClient.get(endpoint);
      
      const guests = Array.isArray(response.data) ? response.data : [response.data];
      const syncResults = [];

      for (const guest of guests) {
        try {
          const syncResult = await this.processGuestData(guest);
          syncResults.push(syncResult);
        } catch (error) {
          console.error(`Error processing guest ${guest.id}:`, error);
          syncResults.push({
            guestId: guest.id,
            success: false,
            error: error.message
          });
        }
      }

      return {
        success: true,
        processed: syncResults.length,
        results: syncResults
      };

    } catch (error) {
      console.error('PMS sync error:', error);
      throw new Error(`PMS sync failed: ${error.message}`);
    }
  }

  async processGuestData(guestData) {
    const {
      id: pmsGuestId,
      email,
      firstName,
      lastName,
      phone,
      preferences = {},
      loyaltyNumber = null
    } = guestData;

    // Check if user exists in loyalty system
    let userQuery = 'SELECT id, email FROM users WHERE email = $1 AND deleted_at IS NULL';
    let userResult = await db.query(userQuery, [email]);
    
    let userId;
    let isNewUser = false;

    if (userResult.rows.length === 0) {
      // Create new user if they don't exist
      const createUserQuery = `
        INSERT INTO users (email, first_name, last_name, phone_number, preferences, pms_guest_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `;

      const newUserResult = await db.query(createUserQuery, [
        email,
        firstName,
        lastName,
        phone,
        JSON.stringify(preferences),
        pmsGuestId
      ]);

      userId = newUserResult.rows[0].id;
      isNewUser = true;
    } else {
      userId = userResult.rows[0].id;
      
      // Update existing user with PMS data
      const updateUserQuery = `
        UPDATE users 
        SET first_name = $1, last_name = $2, phone_number = $3, 
            preferences = COALESCE(preferences, '{}') || $4, pms_guest_id = $5,
            updated_at = NOW()
        WHERE id = $6
      `;

      await db.query(updateUserQuery, [
        firstName,
        lastName,
        phone,
        JSON.stringify(preferences),
        pmsGuestId,
        userId
      ]);
    }

    return {
      guestId: pmsGuestId,
      userId,
      email,
      success: true,
      isNewUser,
      action: isNewUser ? 'created' : 'updated'
    };
  }

  async syncBookingData(bookingId = null) {
    try {
      const endpoint = bookingId ? `/bookings/${bookingId}` : '/bookings';
      const response = await this.apiClient.get(endpoint, {
        params: {
          status: 'confirmed,checked_in,completed',
          updated_since: this.getLastSyncTime()
        }
      });

      const bookings = Array.isArray(response.data) ? response.data : [response.data];
      const syncResults = [];

      for (const booking of bookings) {
        try {
          const syncResult = await this.processBookingData(booking);
          syncResults.push(syncResult);
        } catch (error) {
          console.error(`Error processing booking ${booking.id}:`, error);
          syncResults.push({
            bookingId: booking.id,
            success: false,
            error: error.message
          });
        }
      }

      // Update last sync time
      await this.updateLastSyncTime('bookings');

      return {
        success: true,
        processed: syncResults.length,
        results: syncResults
      };

    } catch (error) {
      console.error('Booking sync error:', error);
      throw new Error(`Booking sync failed: ${error.message}`);
    }
  }

  async processBookingData(bookingData) {
    const {
      id: pmsBookingId,
      guestEmail,
      checkInDate,
      checkOutDate,
      roomType,
      totalAmount,
      status,
      services = []
    } = bookingData;

    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Find user by email
      const userQuery = 'SELECT id, loyalty_tier FROM users WHERE email = $1 AND deleted_at IS NULL';
      const userResult = await client.query(userQuery, [guestEmail]);

      if (userResult.rows.length === 0) {
        throw new Error(`User not found for email: ${guestEmail}`);
      }

      const { id: userId, loyalty_tier: loyaltyTier } = userResult.rows[0];

      // Create or update booking
      const bookingQuery = `
        INSERT INTO bookings (
          pms_booking_id, user_id, booking_reference, room_type,
          checkin_date, checkout_date, total_amount, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (pms_booking_id)
        DO UPDATE SET
          status = $8,
          total_amount = $7,
          updated_at = NOW()
        RETURNING id, status
      `;

      const bookingResult = await client.query(bookingQuery, [
        pmsBookingId,
        userId,
        pmsBookingId, // Using PMS ID as reference
        roomType,
        checkInDate,
        checkOutDate,
        totalAmount,
        status
      ]);

      const bookingId = bookingResult.rows[0].id;
      const currentStatus = bookingResult.rows[0].status;

      // Award points if booking is completed and points haven't been awarded yet
      let pointsAwarded = 0;
      if (status === 'completed' && currentStatus !== 'completed') {
        pointsAwarded = await this.awardBookingPoints(
          client, 
          userId, 
          totalAmount, 
          loyaltyTier, 
          bookingId
        );
      }

      await client.query('COMMIT');

      return {
        bookingId: pmsBookingId,
        userId,
        bookingDbId: bookingId,
        status,
        pointsAwarded,
        success: true,
        action: 'processed'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async awardBookingPoints(client, userId, bookingAmount, loyaltyTier, bookingId) {
    // Calculate points based on tier multiplier
    const tierQuery = 'SELECT point_multiplier FROM loyalty_tiers WHERE tier_name = $1';
    const tierResult = await client.query(tierQuery, [loyaltyTier]);
    const multiplier = tierResult.rows[0]?.point_multiplier || 1.0;

    const basePoints = Math.floor(bookingAmount); // 1 point per dollar
    const bonusPoints = Math.floor(basePoints * (multiplier - 1));
    const totalPoints = basePoints + bonusPoints;

    // Create point transaction
    const pointsQuery = `
      INSERT INTO point_transactions (
        user_id, points_amount, transaction_type, description, 
        reference_id, reference_type, expires_at
      ) VALUES ($1, $2, 'earned', $3, $4, 'booking', $5)
    `;

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 2); // Points expire in 2 years

    await client.query(pointsQuery, [
      userId,
      totalPoints,
      `Booking stay - ${basePoints} base + ${bonusPoints} bonus points`,
      bookingId,
      expiresAt
    ]);

    // Update user's total points
    await client.query(
      'UPDATE users SET total_points = total_points + $1, updated_at = NOW() WHERE id = $2',
      [totalPoints, userId]
    );

    return totalPoints;
  }

  async getLastSyncTime() {
    const query = `
      SELECT last_sync_time 
      FROM integration_sync_status 
      WHERE service_name = 'pms' AND sync_type = 'bookings'
    `;

    const result = await db.query(query);
    
    if (result.rows.length > 0) {
      return result.rows[0].last_sync_time;
    }

    // Default to 7 days ago for first sync
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() - 7);
    return defaultDate.toISOString();
  }

  async updateLastSyncTime(syncType) {
    const query = `
      INSERT INTO integration_sync_status (service_name, sync_type, last_sync_time)
      VALUES ('pms', $1, NOW())
      ON CONFLICT (service_name, sync_type)
      DO UPDATE SET last_sync_time = NOW()
    `;

    await db.query(query, [syncType]);
  }

  async testConnection() {
    try {
      const response = await this.apiClient.get('/health');
      return {
        success: true,
        status: response.status,
        message: 'PMS connection successful'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'PMS connection failed'
      };
    }
  }

  async getBookingsByGuest(guestEmail) {
    try {
      const response = await this.apiClient.get('/bookings', {
        params: { guest_email: guestEmail }
      });

      return {
        success: true,
        bookings: response.data
      };
    } catch (error) {
      throw new Error(`Failed to fetch guest bookings: ${error.message}`);
    }
  }

  async updateGuestPreferences(guestId, preferences) {
    try {
      const response = await this.apiClient.put(`/guests/${guestId}`, {
        preferences
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      throw new Error(`Failed to update guest preferences: ${error.message}`);
    }
  }
}

module.exports = new PMSService();