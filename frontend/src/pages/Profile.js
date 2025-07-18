import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import './Profile.css';

const Profile = () => {
  const { user, updateUser } = useAuth();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    dateOfBirth: '',
    preferences: {
      roomType: '',
      smokingPreference: '',
      bedType: '',
      floorPreference: '',
      communicationPreferences: {
        email: true,
        sms: false,
        push: true
      }
    }
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        phoneNumber: user.phoneNumber || '',
        dateOfBirth: user.dateOfBirth ? user.dateOfBirth.split('T')[0] : '',
        preferences: {
          roomType: user.preferences?.roomType || '',
          smokingPreference: user.preferences?.smokingPreference || '',
          bedType: user.preferences?.bedType || '',
          floorPreference: user.preferences?.floorPreference || '',
          communicationPreferences: {
            email: user.preferences?.communicationPreferences?.email ?? true,
            sms: user.preferences?.communicationPreferences?.sms ?? false,
            push: user.preferences?.communicationPreferences?.push ?? true
          }
        }
      });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (name.startsWith('preferences.')) {
      const prefKey = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        preferences: {
          ...prev.preferences,
          [prefKey]: value
        }
      }));
    } else if (name.startsWith('communicationPreferences.')) {
      const commKey = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        preferences: {
          ...prev.preferences,
          communicationPreferences: {
            ...prev.preferences.communicationPreferences,
            [commKey]: checked
          }
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handlePasswordChange = (e) => {
    setPasswordData({
      ...passwordData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await authService.updateProfile(formData);
      updateUser(response.data.user);
      setMessage('Profile updated successfully!');
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to update profile');
    }
    
    setLoading(false);
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('New passwords do not match');
      setLoading(false);
      return;
    }

    try {
      await authService.changePassword(passwordData.currentPassword, passwordData.newPassword);
      setMessage('Password changed successfully!');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to change password');
    }
    
    setLoading(false);
  };

  if (!user) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="profile-container">
      <div className="container">
        <h1>My Profile</h1>
        
        {message && (
          <div className="alert alert-success">
            {message}
          </div>
        )}
        
        {error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}

        <div className="profile-grid">
          <div className="profile-section">
            <h2>Personal Information</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="firstName">First Name</label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="lastName">Last Name</label>
                  <input
                    type="text"
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label htmlFor="phoneNumber">Phone Number</label>
                <input
                  type="tel"
                  id="phoneNumber"
                  name="phoneNumber"
                  value={formData.phoneNumber}
                  onChange={handleChange}
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="dateOfBirth">Date of Birth</label>
                <input
                  type="date"
                  id="dateOfBirth"
                  name="dateOfBirth"
                  value={formData.dateOfBirth}
                  onChange={handleChange}
                />
              </div>

              <h3>Preferences</h3>
              
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="roomType">Room Type Preference</label>
                  <select
                    id="roomType"
                    name="preferences.roomType"
                    value={formData.preferences.roomType}
                    onChange={handleChange}
                  >
                    <option value="">Select room type</option>
                    <option value="standard">Standard</option>
                    <option value="deluxe">Deluxe</option>
                    <option value="suite">Suite</option>
                    <option value="presidential">Presidential</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label htmlFor="smokingPreference">Smoking Preference</label>
                  <select
                    id="smokingPreference"
                    name="preferences.smokingPreference"
                    value={formData.preferences.smokingPreference}
                    onChange={handleChange}
                  >
                    <option value="">Select preference</option>
                    <option value="non-smoking">Non-smoking</option>
                    <option value="smoking">Smoking</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="bedType">Bed Type Preference</label>
                  <select
                    id="bedType"
                    name="preferences.bedType"
                    value={formData.preferences.bedType}
                    onChange={handleChange}
                  >
                    <option value="">Select bed type</option>
                    <option value="king">King</option>
                    <option value="queen">Queen</option>
                    <option value="twin">Twin</option>
                    <option value="double">Double</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label htmlFor="floorPreference">Floor Preference</label>
                  <select
                    id="floorPreference"
                    name="preferences.floorPreference"
                    value={formData.preferences.floorPreference}
                    onChange={handleChange}
                  >
                    <option value="">Select floor preference</option>
                    <option value="low">Low floors</option>
                    <option value="mid">Mid floors</option>
                    <option value="high">High floors</option>
                  </select>
                </div>
              </div>

              <h3>Communication Preferences</h3>
              
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="communicationPreferences.email"
                    checked={formData.preferences.communicationPreferences.email}
                    onChange={handleChange}
                  />
                  Email notifications
                </label>
                
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="communicationPreferences.sms"
                    checked={formData.preferences.communicationPreferences.sms}
                    onChange={handleChange}
                  />
                  SMS notifications
                </label>
                
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="communicationPreferences.push"
                    checked={formData.preferences.communicationPreferences.push}
                    onChange={handleChange}
                  />
                  Push notifications
                </label>
              </div>
              
              <button type="submit" className="btn" disabled={loading}>
                {loading ? 'Updating...' : 'Update Profile'}
              </button>
            </form>
          </div>

          <div className="profile-section">
            <h2>Change Password</h2>
            <form onSubmit={handlePasswordSubmit}>
              <div className="form-group">
                <label htmlFor="currentPassword">Current Password</label>
                <input
                  type="password"
                  id="currentPassword"
                  name="currentPassword"
                  value={passwordData.currentPassword}
                  onChange={handlePasswordChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="newPassword">New Password</label>
                <input
                  type="password"
                  id="newPassword"
                  name="newPassword"
                  value={passwordData.newPassword}
                  onChange={handlePasswordChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm New Password</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={passwordData.confirmPassword}
                  onChange={handlePasswordChange}
                  required
                />
              </div>
              
              <button type="submit" className="btn" disabled={loading}>
                {loading ? 'Changing...' : 'Change Password'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;