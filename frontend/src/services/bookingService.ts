import api from './authService';

export interface RoomTypeAvailability {
  id: string;
  name: string;
  description: string | null;
  pricePerNight: number;
  maxGuests: number;
  bedType: string | null;
  amenities: string[] | null;
  images: string[] | null;
  availableRooms: number;
}

export interface BookingSlip {
  id: string;
  slipUrl: string;
  uploadedAt: string | Date;
  slipokStatus: 'pending' | 'verified' | 'failed' | 'quota_exceeded' | null;
  adminStatus: 'pending' | 'verified' | 'needs_action' | null;
}

export interface Booking {
  id: string;
  roomTypeName: string;
  checkInDate: string | Date;
  checkOutDate: string | Date;
  numGuests: number;
  totalPrice: number | string;
  pointsEarned: number;
  status: string;
  notes?: string;
  cancellationReason?: string;
  cancelledByAdmin?: boolean;
  createdAt: string | Date;
  paymentType?: 'deposit' | 'full' | null;
  paymentAmount?: number;
  slips?: BookingSlip[];
  slipUrl?: string;
  slipUploadedAt?: string | Date;
  slipOkStatus?: 'pending' | 'verified' | 'failed' | 'quota_exceeded' | null;
  adminVerificationStatus?: 'pending' | 'verified' | 'needs_action' | null;
  verifiedAt?: string | Date;
  verifiedBy?: string;
}

export interface CreateBookingData {
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
  numGuests: number;
  notes?: string;
}

export const bookingService = {
  async checkAvailability(checkIn: Date, checkOut: Date): Promise<RoomTypeAvailability[]> {
    const response = await api.get('/bookings/availability', {
      params: {
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
      },
    });
    return response.data.data;
  },

  async createBooking(data: CreateBookingData): Promise<Booking> {
    const response = await api.post('/bookings', {
      roomTypeId: data.roomTypeId,
      checkIn: data.checkIn.toISOString(),
      checkOut: data.checkOut.toISOString(),
      numGuests: data.numGuests,
      notes: data.notes,
    });
    return response.data.data;
  },

  async getMyBookings(): Promise<Booking[]> {
    const response = await api.get('/bookings');
    return response.data.data;
  },

  async cancelBooking(id: string, reason?: string): Promise<void> {
    await api.post(`/bookings/${id}/cancel`, { reason });
  },

  async addSlip(bookingId: string, slipUrl: string): Promise<void> {
    await api.post(`/bookings/${bookingId}/slips`, { slipUrl });
  },

  async removeSlip(slipId: string): Promise<void> {
    await api.delete(`/bookings/slips/${slipId}`);
  },

  async uploadSlip(file: File): Promise<{ url: string }> {
    const formData = new FormData();
    formData.append('slip', file);
    const response = await api.post<{ url: string }>('/slips/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};
