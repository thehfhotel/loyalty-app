import React, { useState, useEffect } from 'react';
import { User, Save, Mail, Phone, Calendar, Settings, Shield } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { Customer, CustomerUpdateRequest } from '@hotel-loyalty/shared/types/customer';
import { authService } from '../../services/authService';
import { toast } from 'react-hot-toast';

const ProfilePage: React.FC = () => {
  const { user, updateUser } = useAuthStore();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    dateOfBirth: '',
    preferences: {
      emailNotifications: true,
      smsNotifications: false,
      marketingEmails: true,
      language: 'en',
      currency: 'USD'
    }
  });

  useEffect(() => {
    loadCustomerProfile();
  }, []);

  const loadCustomerProfile = async () => {
    try {
      setLoading(true);
      const response = await authService.makeAuthenticatedRequest<Customer>(
        '/api/customers/profile'
      );
      
      if (response.success) {
        setCustomer(response.data);
        setFormData({
          firstName: response.data.firstName,
          lastName: response.data.lastName,
          phone: response.data.phone || '',
          dateOfBirth: response.data.dateOfBirth 
            ? new Date(response.data.dateOfBirth).toISOString().split('T')[0]
            : '',
          preferences: {
            emailNotifications: response.data.profile.preferences?.emailNotifications ?? true,
            smsNotifications: response.data.profile.preferences?.smsNotifications ?? false,
            marketingEmails: response.data.profile.preferences?.marketingEmails ?? true,
            language: response.data.profile.preferences?.language ?? 'en',
            currency: response.data.profile.preferences?.currency ?? 'USD'
          }
        });
      } else {
        toast.error(response.message || 'Failed to load profile');
      }
    } catch (error) {
      toast.error('Failed to load profile');
      console.error('Profile load error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    if (name.startsWith('preferences.')) {
      const prefKey = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        preferences: {
          ...prev.preferences,
          [prefKey]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      
      const updateData: CustomerUpdateRequest = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone || undefined,
        dateOfBirth: formData.dateOfBirth ? new Date(formData.dateOfBirth) : undefined,
        preferences: formData.preferences
      };

      const response = await authService.makeAuthenticatedRequest<Customer>(
        '/api/customers/profile',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        }
      );

      if (response.success) {
        setCustomer(response.data);
        updateUser({
          firstName: response.data.firstName,
          lastName: response.data.lastName,
        });
        toast.success('Profile updated successfully');
      } else {
        toast.error(response.message || 'Failed to update profile');
      }
    } catch (error) {
      toast.error('Failed to update profile');
      console.error('Profile update error:', error);
    } finally {
      setSaving(false);
    }
  };

  const getTierColor = (tierName: string) => {
    switch (tierName?.toLowerCase()) {
      case 'bronze': return 'from-amber-600 to-amber-700';
      case 'silver': return 'from-gray-400 to-gray-500';
      case 'gold': return 'from-yellow-400 to-yellow-500';
      case 'platinum': return 'from-purple-500 to-purple-600';
      default: return 'from-blue-500 to-blue-600';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-300 rounded w-64 mb-6"></div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="space-y-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i}>
                    <div className="h-4 bg-gray-300 rounded w-24 mb-2"></div>
                    <div className="h-10 bg-gray-300 rounded"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
            <p className="text-gray-600 mt-1">Manage your profile and preferences</p>
          </div>
          {customer && (
            <div className="mt-4 sm:mt-0">
              <span className={`inline-flex items-center px-4 py-2 rounded-full text-white text-sm font-medium bg-gradient-to-r ${getTierColor(customer.tier.name)}`}>
                {customer.tier.name} Member
              </span>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('profile')}
                className={`py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'profile'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <User className="w-4 h-4 inline mr-2" />
                Profile
              </button>
              <button
                onClick={() => setActiveTab('preferences')}
                className={`py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'preferences'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Settings className="w-4 h-4 inline mr-2" />
                Preferences
              </button>
              <button
                onClick={() => setActiveTab('security')}
                className={`py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'security'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Shield className="w-4 h-4 inline mr-2" />
                Security
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'profile' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Personal Information</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-2">
                      First Name
                    </label>
                    <input
                      type="text"
                      id="firstName"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      className="input"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name
                    </label>
                    <input
                      type="text"
                      id="lastName"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      className="input"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        id="email"
                        value={customer?.email || ''}
                        className="input bg-gray-50"
                        disabled
                      />
                      <Mail className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Email cannot be changed. Contact support if needed.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                      Phone Number
                    </label>
                    <div className="relative">
                      <input
                        type="tel"
                        id="phone"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                        className="input"
                        placeholder="+1 (555) 123-4567"
                      />
                      <Phone className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700 mb-2">
                      Date of Birth
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        id="dateOfBirth"
                        name="dateOfBirth"
                        value={formData.dateOfBirth}
                        onChange={handleInputChange}
                        className="input"
                      />
                      <Calendar className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                    </div>
                  </div>
                </div>

                {customer && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Account Status</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Member Since:</span>
                        <p className="font-medium">
                          {new Date(customer.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-600">Email Status:</span>
                        <p className={`font-medium ${customer.emailVerified ? 'text-green-600' : 'text-red-600'}`}>
                          {customer.emailVerified ? 'Verified' : 'Unverified'}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-600">Account Status:</span>
                        <p className={`font-medium ${customer.isActive ? 'text-green-600' : 'text-red-600'}`}>
                          {customer.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'preferences' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Notification Preferences</h3>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">Email Notifications</h4>
                      <p className="text-sm text-gray-600">Receive important updates via email</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="preferences.emailNotifications"
                        checked={formData.preferences.emailNotifications}
                        onChange={handleInputChange}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">SMS Notifications</h4>
                      <p className="text-sm text-gray-600">Receive urgent alerts via SMS</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="preferences.smsNotifications"
                        checked={formData.preferences.smsNotifications}
                        onChange={handleInputChange}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">Marketing Emails</h4>
                      <p className="text-sm text-gray-600">Receive promotions and special offers</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="preferences.marketingEmails"
                        checked={formData.preferences.marketingEmails}
                        onChange={handleInputChange}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-gray-200">
                  <div>
                    <label htmlFor="language" className="block text-sm font-medium text-gray-700 mb-2">
                      Language
                    </label>
                    <select
                      id="language"
                      name="preferences.language"
                      value={formData.preferences.language}
                      onChange={handleInputChange}
                      className="input"
                    >
                      <option value="en">English</option>
                      <option value="es">Español</option>
                      <option value="fr">Français</option>
                      <option value="de">Deutsch</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="currency" className="block text-sm font-medium text-gray-700 mb-2">
                      Currency
                    </label>
                    <select
                      id="currency"
                      name="preferences.currency"
                      value={formData.preferences.currency}
                      onChange={handleInputChange}
                      className="input"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="CAD">CAD ($)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Security Settings</h3>
                
                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Password</h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Change your password to keep your account secure
                    </p>
                    <button className="btn btn-secondary">
                      Change Password
                    </button>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Two-Factor Authentication</h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Add an extra layer of security to your account
                    </p>
                    <button className="btn btn-secondary">
                      Enable 2FA
                    </button>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Login History</h4>
                    <p className="text-sm text-gray-600 mb-4">
                      View recent login activity on your account
                    </p>
                    <button className="btn btn-secondary">
                      View History
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-6 border-t border-gray-200">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;