import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3012';

const loyaltyService = {
  getDashboard: async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No token found');
    }

    const response = await axios.get(`${API_URL}/api/v1/loyalty/dashboard`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  },

  getPointsBalance: async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No token found');
    }

    const response = await axios.get(`${API_URL}/api/v1/loyalty/points`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  },

  getTransactions: async (page = 1, limit = 20) => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No token found');
    }

    const response = await axios.get(`${API_URL}/api/v1/transactions?page=${page}&limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  },

  getTierInfo: async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No token found');
    }

    const response = await axios.get(`${API_URL}/api/v1/tiers/my-tier`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  },

  getRewards: async (page = 1, limit = 20) => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No token found');
    }

    const response = await axios.get(`${API_URL}/api/v1/rewards?page=${page}&limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  }
};

export { loyaltyService };