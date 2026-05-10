import axios from 'axios';
import { addAuthTokenInterceptor } from '../utils/axiosInterceptor';
import { API_BASE_URL } from '../utils/apiConfig';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

addAuthTokenInterceptor(api);

export interface PromptPayQrResponse {
  svg: string;
  amount: number;
  currency: string;
}

export const paymentService = {
  async getPromptPayQr(amount: number, bookingId: string): Promise<PromptPayQrResponse> {
    const response = await api.get<PromptPayQrResponse>('/payments/promptpay-qr', {
      params: { amount, booking_id: bookingId },
    });
    return response.data;
  },
};
