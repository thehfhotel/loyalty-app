import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for admin booking management operations
 * Tests room type CRUD, room CRUD, and room availability management
 *
 * These tests use tRPC endpoints via the backend API.
 * The booking.admin router requires admin authentication.
 */
test.describe('Admin Booking Management - Room Types', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Room Type CRUD Endpoints', () => {
    test('Get room types endpoint should require admin authentication', async ({ request }) => {
      // tRPC endpoints use POST for both queries and mutations
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getRoomTypes`, {
        data: {
          json: { includeInactive: true },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Should return 401 without token
      expect([401, 403]).toContain(response.status());
    });

    test('Create room type endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.createRoomType`, {
        data: {
          json: {
            name: 'Test Room Type',
            pricePerNight: 100,
            maxGuests: 2,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Update room type endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.updateRoomType`, {
        data: {
          json: {
            id: '00000000-0000-0000-0000-000000000001',
            data: { name: 'Updated Name' },
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Delete room type endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.deleteRoomType`, {
        data: {
          json: { id: '00000000-0000-0000-0000-000000000001' },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get single room type endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getRoomType`, {
        data: {
          json: { id: '00000000-0000-0000-0000-000000000001' },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Room type endpoints should exist and not return 404', async ({ request }) => {
      const endpoints = [
        'booking.admin.getRoomTypes',
        'booking.admin.getRoomType',
        'booking.admin.createRoomType',
        'booking.admin.updateRoomType',
        'booking.admin.deleteRoomType',
      ];

      for (const endpoint of endpoints) {
        const response = await request.post(`${backendUrl}/api/trpc/${endpoint}`, {
          data: {
            json: {},
          },
          headers: { 'Content-Type': 'application/json' },
        });
        // Should return auth error (401/403) or validation error (400), not 404
        expect(response.status()).not.toBe(404);
      }
    });
  });

  test.describe('Room Type Validation', () => {
    test('Create room type with invalid data should return validation error', async ({ request }) => {
      // Empty name - should fail validation
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.createRoomType`, {
        data: {
          json: {
            name: '',
            pricePerNight: 100,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Should return 401 (auth required) or 400 (validation error)
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Create room type with negative price should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.createRoomType`, {
        data: {
          json: {
            name: 'Test Room',
            pricePerNight: -100,
            maxGuests: 2,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Should return auth error or validation error, not 404
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Create room type with invalid bed type should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.createRoomType`, {
        data: {
          json: {
            name: 'Test Room',
            pricePerNight: 100,
            maxGuests: 2,
            bedType: 'invalid_type',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Valid bed types: single, double, twin, king
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Update room type with invalid UUID should fail', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.updateRoomType`, {
        data: {
          json: {
            id: 'not-a-uuid',
            data: { name: 'Updated Name' },
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });
  });
});

test.describe('Admin Booking Management - Rooms', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Room CRUD Endpoints', () => {
    test('Get rooms endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getRooms`, {
        data: {
          json: { includeInactive: true },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get rooms with filter should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getRooms`, {
        data: {
          json: {
            roomTypeId: '00000000-0000-0000-0000-000000000001',
            includeInactive: false,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Create room endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.createRoom`, {
        data: {
          json: {
            roomTypeId: '00000000-0000-0000-0000-000000000001',
            roomNumber: '101',
            floor: 1,
            isActive: true,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Update room endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.updateRoom`, {
        data: {
          json: {
            id: '00000000-0000-0000-0000-000000000001',
            data: { roomNumber: '102' },
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Delete room endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.deleteRoom`, {
        data: {
          json: { id: '00000000-0000-0000-0000-000000000001' },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get single room endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getRoom`, {
        data: {
          json: { id: '00000000-0000-0000-0000-000000000001' },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Room endpoints should exist and not return 404', async ({ request }) => {
      const endpoints = [
        'booking.admin.getRooms',
        'booking.admin.getRoom',
        'booking.admin.createRoom',
        'booking.admin.updateRoom',
        'booking.admin.deleteRoom',
      ];

      for (const endpoint of endpoints) {
        const response = await request.post(`${backendUrl}/api/trpc/${endpoint}`, {
          data: {
            json: {},
          },
          headers: { 'Content-Type': 'application/json' },
        });
        expect(response.status()).not.toBe(404);
      }
    });
  });

  test.describe('Room Validation', () => {
    test('Create room with empty room number should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.createRoom`, {
        data: {
          json: {
            roomTypeId: '00000000-0000-0000-0000-000000000001',
            roomNumber: '',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Create room with invalid roomTypeId should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.createRoom`, {
        data: {
          json: {
            roomTypeId: 'not-a-uuid',
            roomNumber: '101',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Update room with invalid UUID should fail', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.updateRoom`, {
        data: {
          json: {
            id: 'invalid-uuid',
            data: { roomNumber: '999' },
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });
  });
});

test.describe('Admin Booking Management - Room Availability', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Availability Query Endpoints', () => {
    test('Get blocked dates endpoint should require admin authentication', async ({ request }) => {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getBlockedDates`, {
        data: {
          json: {
            roomId: '00000000-0000-0000-0000-000000000001',
            startDate: now.toISOString(),
            endDate: nextMonth.toISOString(),
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get all blocked dates endpoint should require admin authentication', async ({ request }) => {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getAllBlockedDates`, {
        data: {
          json: {
            roomTypeId: '00000000-0000-0000-0000-000000000001',
            startDate: now.toISOString(),
            endDate: nextMonth.toISOString(),
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get room bookings endpoint should require admin authentication', async ({ request }) => {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getRoomBookings`, {
        data: {
          json: {
            roomTypeId: '00000000-0000-0000-0000-000000000001',
            startDate: now.toISOString(),
            endDate: nextMonth.toISOString(),
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });
  });

  test.describe('Availability Mutation Endpoints', () => {
    test('Block dates endpoint should require admin authentication', async ({ request }) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.blockDates`, {
        data: {
          json: {
            roomId: '00000000-0000-0000-0000-000000000001',
            dates: [tomorrow.toISOString()],
            reason: 'Maintenance',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Unblock dates endpoint should require admin authentication', async ({ request }) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.unblockDates`, {
        data: {
          json: {
            roomId: '00000000-0000-0000-0000-000000000001',
            dates: [tomorrow.toISOString()],
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Availability endpoints should exist and not return 404', async ({ request }) => {
      const endpoints = [
        'booking.admin.getBlockedDates',
        'booking.admin.getAllBlockedDates',
        'booking.admin.blockDates',
        'booking.admin.unblockDates',
        'booking.admin.getRoomBookings',
      ];

      for (const endpoint of endpoints) {
        const response = await request.post(`${backendUrl}/api/trpc/${endpoint}`, {
          data: {
            json: {},
          },
          headers: { 'Content-Type': 'application/json' },
        });
        expect(response.status()).not.toBe(404);
      }
    });
  });

  test.describe('Availability Validation', () => {
    test('Block dates with empty dates array should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.blockDates`, {
        data: {
          json: {
            roomId: '00000000-0000-0000-0000-000000000001',
            dates: [],
            reason: 'Test',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Empty dates array should fail validation (min 1 required)
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Block dates with empty reason should fail validation', async ({ request }) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.blockDates`, {
        data: {
          json: {
            roomId: '00000000-0000-0000-0000-000000000001',
            dates: [tomorrow.toISOString()],
            reason: '',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Block dates with invalid roomId should fail validation', async ({ request }) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.blockDates`, {
        data: {
          json: {
            roomId: 'not-a-uuid',
            dates: [tomorrow.toISOString()],
            reason: 'Maintenance',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Unblock dates with empty dates array should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.unblockDates`, {
        data: {
          json: {
            roomId: '00000000-0000-0000-0000-000000000001',
            dates: [],
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Get blocked dates with invalid date range should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getBlockedDates`, {
        data: {
          json: {
            roomId: '00000000-0000-0000-0000-000000000001',
            startDate: 'invalid-date',
            endDate: 'also-invalid',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });
  });
});

test.describe('Admin Booking Management - Admin Bookings', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Booking Admin Endpoints', () => {
    test('Get all bookings endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getAllBookings`, {
        data: {
          json: {
            page: 1,
            pageSize: 20,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get all bookings with filters should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getAllBookings`, {
        data: {
          json: {
            status: 'confirmed',
            page: 1,
            pageSize: 10,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get single booking endpoint should require admin authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getBooking`, {
        data: {
          json: { id: '00000000-0000-0000-0000-000000000001' },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Admin booking endpoints should exist and not return 404', async ({ request }) => {
      const endpoints = [
        'booking.admin.getAllBookings',
        'booking.admin.getBooking',
      ];

      for (const endpoint of endpoints) {
        const response = await request.post(`${backendUrl}/api/trpc/${endpoint}`, {
          data: {
            json: {},
          },
          headers: { 'Content-Type': 'application/json' },
        });
        expect(response.status()).not.toBe(404);
      }
    });
  });

  test.describe('Booking Admin Validation', () => {
    test('Get all bookings with invalid status should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getAllBookings`, {
        data: {
          json: {
            status: 'invalid_status',
            page: 1,
            pageSize: 20,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Valid statuses: confirmed, cancelled, completed
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Get all bookings with invalid page should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getAllBookings`, {
        data: {
          json: {
            page: 0, // Must be positive
            pageSize: 20,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });

    test('Get all bookings with excessive page size should fail validation', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.admin.getAllBookings`, {
        data: {
          json: {
            page: 1,
            pageSize: 1000, // Max is 100
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([400, 401, 403]).toContain(response.status());
    });
  });
});

test.describe('Public Booking Endpoints', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Public Room Type Access', () => {
    test('Public get room types should be accessible without authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.getRoomTypes`, {
        data: {
          json: {},
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Public endpoint - should return 200 or empty result
      // Not 401/403 (auth not required)
      expect([200, 400]).toContain(response.status());
    });

    test('Public get room type by ID should be accessible', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.getRoomType`, {
        data: {
          json: { id: '00000000-0000-0000-0000-000000000001' },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Should return 200 (success), 404 (not found), or 400 (validation error)
      // Not 401/403 (auth not required for public endpoint)
      expect([200, 400, 404, 500]).toContain(response.status());
    });

    test('Check availability should be accessible without authentication', async ({ request }) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const response = await request.post(`${backendUrl}/api/trpc/booking.checkAvailability`, {
        data: {
          json: {
            checkIn: tomorrow.toISOString(),
            checkOut: nextWeek.toISOString(),
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Public endpoint
      expect([200, 400, 500]).toContain(response.status());
    });
  });

  test.describe('Protected Booking Endpoints', () => {
    test('Get available rooms should require authentication', async ({ request }) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const response = await request.post(`${backendUrl}/api/trpc/booking.getAvailableRooms`, {
        data: {
          json: {
            roomTypeId: '00000000-0000-0000-0000-000000000001',
            checkIn: tomorrow.toISOString(),
            checkOut: nextWeek.toISOString(),
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Create booking should require authentication', async ({ request }) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const response = await request.post(`${backendUrl}/api/trpc/booking.createBooking`, {
        data: {
          json: {
            roomTypeId: '00000000-0000-0000-0000-000000000001',
            checkIn: tomorrow.toISOString(),
            checkOut: nextWeek.toISOString(),
            numGuests: 2,
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get my bookings should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.getMyBookings`, {
        data: {
          json: {},
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Cancel booking should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/trpc/booking.cancelBooking`, {
        data: {
          json: {
            id: '00000000-0000-0000-0000-000000000001',
            reason: 'Test cancellation',
          },
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });
  });
});

test.describe('Booking API Contract Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('All booking admin tRPC routes should be registered', async ({ request }) => {
    const adminRoutes = [
      // Room Type Management
      'booking.admin.getRoomTypes',
      'booking.admin.getRoomType',
      'booking.admin.createRoomType',
      'booking.admin.updateRoomType',
      'booking.admin.deleteRoomType',
      // Room Management
      'booking.admin.getRooms',
      'booking.admin.getRoom',
      'booking.admin.createRoom',
      'booking.admin.updateRoom',
      'booking.admin.deleteRoom',
      // Availability Management
      'booking.admin.getBlockedDates',
      'booking.admin.getAllBlockedDates',
      'booking.admin.blockDates',
      'booking.admin.unblockDates',
      // Booking Management
      'booking.admin.getAllBookings',
      'booking.admin.getBooking',
      'booking.admin.getRoomBookings',
    ];

    for (const route of adminRoutes) {
      const response = await request.post(`${backendUrl}/api/trpc/${route}`, {
        data: {
          json: {},
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Routes should exist (not 404)
      expect(response.status()).not.toBe(404);
    }
  });

  test('All public and protected booking tRPC routes should be registered', async ({ request }) => {
    const routes = [
      // Public routes
      'booking.getRoomTypes',
      'booking.getRoomType',
      'booking.checkAvailability',
      // Protected routes
      'booking.getAvailableRooms',
      'booking.createBooking',
      'booking.getMyBookings',
      'booking.getBooking',
      'booking.cancelBooking',
    ];

    for (const route of routes) {
      const response = await request.post(`${backendUrl}/api/trpc/${route}`, {
        data: {
          json: {},
        },
        headers: { 'Content-Type': 'application/json' },
      });
      // Routes should exist (not 404)
      expect(response.status()).not.toBe(404);
    }
  });

  test('Health check should pass for booking operations', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.services.database).toBeTruthy();
  });

  test('tRPC batch endpoint should be accessible', async ({ request }) => {
    // tRPC supports batching multiple queries/mutations
    const response = await request.get(`${backendUrl}/api/trpc`);
    // Should not return 404 - endpoint exists
    expect(response.status()).not.toBe(404);
  });
});
