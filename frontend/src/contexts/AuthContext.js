import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/authService';
import { handleAxiosError } from '../utils/networkErrorHandler';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      authService.getCurrentUser()
        .then(setUser)
        .catch(() => {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    try {
      const response = await authService.login(email, password);
      const { user, accessToken, refreshToken } = response.data;
      
      // Transform user data to match frontend expectations
      const transformedUser = {
        ...user,
        loyaltyTier: user.loyalty_tier,
        totalPoints: user.total_points,
        firstName: user.first_name,
        lastName: user.last_name,
        phoneNumber: user.phone_number,
        dateOfBirth: user.date_of_birth,
        isEmailVerified: user.is_email_verified
      };
      
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      setUser(transformedUser);
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || 'Login failed' 
      };
    }
  };

  const register = async (userData) => {
    try {
      const response = await authService.register(userData);
      const { user, accessToken, refreshToken } = response.data;
      
      // Transform user data to match frontend expectations
      const transformedUser = {
        ...user,
        loyaltyTier: user.loyalty_tier,
        totalPoints: user.total_points,
        firstName: user.first_name,
        lastName: user.last_name,
        phoneNumber: user.phone_number,
        dateOfBirth: user.date_of_birth,
        isEmailVerified: user.is_email_verified
      };
      
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      setUser(transformedUser);
      
      return { success: true };
    } catch (error) {
      const errorInfo = handleAxiosError(error);
      
      // Special handling for ERR_BLOCKED_BY_CLIENT
      if (errorInfo.type === 'BLOCKED_BY_CLIENT') {
        return {
          success: false,
          message: errorInfo.userFriendlyMessage,
          suggestions: errorInfo.suggestions,
          isBlocked: true
        };
      }
      
      return { 
        success: false, 
        message: errorInfo.userFriendlyMessage || 'Registration failed',
        suggestions: errorInfo.suggestions
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
  };

  const updateUser = (updatedUser) => {
    setUser(updatedUser);
  };

  const value = {
    user,
    login,
    register,
    logout,
    updateUser,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};