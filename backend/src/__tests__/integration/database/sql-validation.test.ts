/**
 * SQL Query Validation Tests
 *
 * These tests execute actual SQL queries against a real database to catch:
 * - Column reference errors (e.g., u.membership_id vs up.membership_id)
 * - Table alias errors
 * - JOIN syntax errors
 * - Missing columns
 *
 * Uses LIMIT 0 to validate syntax without returning data (fast execution).
 * Requires DATABASE_URL environment variable pointing to a real PostgreSQL database.
 */

import { connectDatabase, query, closePool } from '../../../config/database';

// Skip if no database URL configured
const shouldRun = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('placeholder');

const describeOrSkip = shouldRun ? describe : describe.skip;

describeOrSkip('SQL Query Validation', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await closePool();
  });

  // ==================== BOOKING SERVICE ====================
  describe('bookingService', () => {
    it('getAllBookingsForAdmin - validates user profile JOIN', async () => {
      // This query previously had a bug: u.membership_id instead of up.membership_id
      const result = await query(`
        SELECT
          b.id, b.user_id as "userId", b.room_id as "roomId", b.room_type_id as "roomTypeId",
          b.check_in_date as "checkInDate", b.check_out_date as "checkOutDate",
          b.num_guests as "numGuests", b.total_price as "totalPrice",
          b.points_earned as "pointsEarned", b.status,
          b.cancelled_at as "cancelledAt", b.cancellation_reason as "cancellationReason",
          b.notes, b.created_at as "createdAt", b.updated_at as "updatedAt",
          b.payment_type as "paymentType", b.payment_amount as "paymentAmount",
          b.slip_image_url as "slipImageUrl", b.slip_uploaded_at as "slipUploadedAt",
          b.slipok_status as "slipokStatus", b.slipok_verified_at as "slipokVerifiedAt",
          b.slipok_response as "slipokResponse",
          b.admin_status as "adminStatus", b.admin_verified_at as "adminVerifiedAt",
          b.admin_verified_by as "adminVerifiedBy", b.admin_notes as "adminNotes",
          b.discount_amount as "discountAmount", b.discount_reason as "discountReason",
          b.original_total as "originalTotal",
          r.room_number as "roomNumber",
          rt.name as "roomTypeName",
          u.email as "userEmail",
          up.first_name as "userFirstName",
          up.last_name as "userLastName",
          up.membership_id as "userMembershipId",
          up.phone as "userPhone"
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON b.room_type_id = rt.id
        JOIN users u ON b.user_id = u.id
        LEFT JOIN user_profiles up ON b.user_id = up.user_id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });

    it('getUserBookings - validates booking/room/roomtype JOIN', async () => {
      const result = await query(`
        SELECT
          b.id, b.user_id as "userId", b.room_id as "roomId", b.room_type_id as "roomTypeId",
          b.check_in_date as "checkInDate", b.check_out_date as "checkOutDate",
          b.num_guests as "numGuests", b.total_price as "totalPrice",
          b.points_earned as "pointsEarned", b.status,
          b.cancelled_at as "cancelledAt", b.cancellation_reason as "cancellationReason",
          b.notes, b.created_at as "createdAt", b.updated_at as "updatedAt",
          rt.name as "roomTypeName"
        FROM bookings b
        JOIN room_types rt ON b.room_type_id = rt.id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });

    it('getRoomTypesWithAvailability - validates room availability subquery', async () => {
      const result = await query(`
        SELECT rt.*,
          (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = rt.id AND r.is_active = true) as "totalRooms"
        FROM room_types rt
        WHERE rt.is_active = true
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== LOYALTY SERVICE ====================
  describe('loyaltyService', () => {
    it('getUserLoyaltyStatus - validates user_loyalty/tiers JOIN', async () => {
      const result = await query(`
        SELECT
          ul.user_id as "userId",
          ul.current_points as "currentPoints",
          ul.total_nights as "totalNights",
          ul.tier_id as "tierId",
          ul.tier_updated_at as "tierUpdatedAt",
          t.name as "tierName",
          t.min_nights as "tierMinNights",
          t.benefits as "tierBenefits"
        FROM user_loyalty ul
        JOIN tiers t ON ul.tier_id = t.id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });

    it('getTransactions - validates points_transactions query', async () => {
      const result = await query(`
        SELECT
          id,
          user_id as "userId",
          type,
          points,
          description,
          reference_id as "referenceId",
          created_at as "createdAt"
        FROM points_transactions
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });

    it('getAllUsersLoyaltyStatus - validates complex user/profile/loyalty JOIN', async () => {
      const result = await query(`
        SELECT
          u.id as "userId",
          u.email,
          up.first_name as "firstName",
          up.last_name as "lastName",
          up.phone,
          ul.current_points as "currentPoints",
          ul.total_nights as "totalNights",
          t.name as "tierName"
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LEFT JOIN user_loyalty ul ON u.id = ul.user_id
        LEFT JOIN tiers t ON ul.tier_id = t.id
        WHERE u.role = 'customer'
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== USER SERVICE ====================
  describe('userService', () => {
    it('getAllUsers - validates user/profile JOIN with search', async () => {
      const result = await query(`
        SELECT
          u.id,
          u.email,
          u.role,
          u.is_active as "isActive",
          u.email_verified as "emailVerified",
          u.created_at as "createdAt",
          u.updated_at as "updatedAt",
          up.first_name as "firstName",
          up.last_name as "lastName",
          up.phone,
          up.membership_id as "membershipId"
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });

    it('getUserById - validates single user lookup with profile', async () => {
      const result = await query(`
        SELECT
          u.id,
          u.email,
          u.role,
          u.is_active AS "isActive",
          u.email_verified AS "emailVerified",
          u.created_at AS "createdAt",
          u.updated_at AS "updatedAt",
          u.oauth_provider AS "oauthProvider",
          up.first_name AS "firstName",
          up.last_name AS "lastName",
          up.phone,
          up.date_of_birth AS "dateOfBirth",
          up.avatar_url AS "avatarUrl",
          up.membership_id AS "membershipId"
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== AUTH SERVICE ====================
  describe('authService', () => {
    it('getUserByEmail - validates user/profile email lookup', async () => {
      const result = await query(`
        SELECT
          u.id,
          u.email,
          u.password_hash as "passwordHash",
          u.role,
          u.is_active AS "isActive",
          u.email_verified AS "emailVerified",
          u.created_at AS "createdAt",
          u.updated_at AS "updatedAt",
          up.first_name AS "firstName",
          up.last_name AS "lastName",
          up.membership_id AS "membershipId"
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== SURVEY SERVICE ====================
  describe('surveyService', () => {
    it('getSurveyWithTranslation - validates survey/translation JOIN', async () => {
      const result = await query(`
        SELECT
          s.*,
          st.title as translated_title,
          st.description as translated_description,
          st.questions as translated_questions
        FROM surveys s
        LEFT JOIN survey_translations st ON s.id = st.survey_id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });

    it('getUserSurveyResponses - validates survey response/survey JOIN', async () => {
      const result = await query(`
        SELECT
          sr.id,
          sr.user_id as "userId",
          sr.survey_id as "surveyId",
          sr.answers,
          sr.is_completed as "isCompleted",
          sr.completed_at as "completedAt",
          sr.created_at as "createdAt",
          s.title as "surveyTitle"
        FROM survey_responses sr
        JOIN surveys s ON sr.survey_id = s.id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== COUPON SERVICE ====================
  describe('couponService', () => {
    it('getUserCoupons - validates user_coupons/coupons JOIN', async () => {
      const result = await query(`
        SELECT
          uc.id,
          uc.user_id as "userId",
          uc.coupon_id as "couponId",
          uc.status,
          uc.created_at as "createdAt",
          uc.used_at as "usedAt",
          uc.expires_at as "expiresAt",
          c.code,
          c.name,
          c.description,
          c.type as "couponType",
          c.value as "couponValue"
        FROM user_coupons uc
        JOIN coupons c ON uc.coupon_id = c.id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== OAUTH SERVICE ====================
  describe('oauthService', () => {
    it('findUserByOAuthId - validates user/profile OAuth lookup', async () => {
      const result = await query(`
        SELECT
          u.id,
          u.email,
          u.role,
          u.oauth_provider as "oauthProvider",
          u.oauth_provider_id as "oauthProviderId",
          up.first_name as "firstName",
          up.last_name as "lastName",
          up.avatar_url as "avatarUrl"
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== NOTIFICATION SERVICE ====================
  describe('notificationService', () => {
    it('getNotifications - validates notification query', async () => {
      const result = await query(`
        SELECT
          id,
          user_id AS "userId",
          title,
          message,
          type,
          data,
          read_at AS "readAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          expires_at AS "expiresAt"
        FROM notifications
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== ANALYTICS SERVICE ====================
  describe('analyticsService', () => {
    it('getUserActivity - validates activity aggregation', async () => {
      const result = await query(`
        SELECT
          COUNT(DISTINCT ul.user_id) as "activeUsers"
        FROM user_loyalty ul
        LIMIT 0
      `);
      expect(result).toBeDefined();
    });
  });

  // ==================== MEMBERSHIP ID SERVICE ====================
  describe('membershipIdService', () => {
    it('checkMembershipIdExists - validates membership check query', async () => {
      const result = await query(`
        SELECT EXISTS(
          SELECT 1 FROM user_profiles WHERE membership_id = '26900001'
          UNION
          SELECT 1 FROM reserved_membership_ids WHERE membership_id = '26900001'
        ) as exists
      `);
      expect(result).toBeDefined();
    });
  });
});
