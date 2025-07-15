import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://192.168.100.228:3011';

const authService = {
  login: async (email, password) => {
    const response = await axios.post(`${API_URL}/api/v1/auth/login`, {
      email,
      password
    });
    return response.data;
  },

  register: async (userData) => {
    const response = await axios.post(`${API_URL}/api/v1/auth/register`, userData);
    return response.data;
  },

  getCurrentUser: async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No token found');
    }

    const response = await axios.get(`${API_URL}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data.data.user;
  },

  updateProfile: async (userData) => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No token found');
    }

    const response = await axios.put(`${API_URL}/api/v1/profile`, userData, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  },

  changePassword: async (currentPassword, newPassword) => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No token found');
    }

    const response = await axios.post(`${API_URL}/api/v1/auth/change-password`, {
      currentPassword,
      newPassword
    }, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  }
};

export { authService };