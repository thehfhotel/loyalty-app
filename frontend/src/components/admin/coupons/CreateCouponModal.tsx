import React, { useState } from 'react';
import { X, Calendar, Tag, DollarSign, Users, Settings } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/Card';

interface CreateCouponModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateCoupon: (couponData: any) => Promise<void>;
}

export const CreateCouponModal: React.FC<CreateCouponModalProps> = ({
  isOpen,
  onClose,
  onCreateCoupon,
}) => {
  const [formData, setFormData] = useState({
    code: '',
    title: '',
    description: '',
    type: 'percentage' as 'percentage' | 'fixed_amount' | 'free_item',
    category: 'general' as 'room' | 'dining' | 'spa' | 'experience' | 'general',
    value: '',
    minSpend: '',
    maxDiscount: '',
    validFrom: '',
    validUntil: '',
    usageLimit: '',
    terms: '',
    isActive: false
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.code.trim()) newErrors.code = 'Coupon code is required';
    if (!formData.title.trim()) newErrors.title = 'Title is required';
    if (!formData.description.trim()) newErrors.description = 'Description is required';
    if (!formData.value || parseFloat(formData.value) <= 0) {
      newErrors.value = 'Value must be greater than 0';
    }
    if (!formData.validFrom) newErrors.validFrom = 'Start date is required';
    if (!formData.validUntil) newErrors.validUntil = 'End date is required';
    
    if (formData.validFrom && formData.validUntil) {
      if (new Date(formData.validFrom) >= new Date(formData.validUntil)) {
        newErrors.validUntil = 'End date must be after start date';
      }
    }

    if (formData.minSpend && parseFloat(formData.minSpend) < 0) {
      newErrors.minSpend = 'Minimum spend cannot be negative';
    }

    if (formData.usageLimit && parseInt(formData.usageLimit) <= 0) {
      newErrors.usageLimit = 'Usage limit must be greater than 0';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const couponData = {
        ...formData,
        value: parseFloat(formData.value),
        minSpend: formData.minSpend ? parseFloat(formData.minSpend) : undefined,
        maxDiscount: formData.maxDiscount ? parseFloat(formData.maxDiscount) : undefined,
        usageLimit: formData.usageLimit ? parseInt(formData.usageLimit) : undefined,
      };

      await onCreateCoupon(couponData);
      
      // Reset form
      setFormData({
        code: '',
        title: '',
        description: '',
        type: 'percentage',
        category: 'general',
        value: '',
        minSpend: '',
        maxDiscount: '',
        validFrom: '',
        validUntil: '',
        usageLimit: '',
        terms: '',
        isActive: false
      });
    } catch (error) {
      console.error('Error creating coupon:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateCode = () => {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    handleChange('code', code);
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Create New Coupon</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Basic Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Tag className="w-5 h-5" />
                    Basic Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Coupon Code
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={formData.code}
                        onChange={(e) => handleChange('code', e.target.value.toUpperCase())}
                        placeholder="Enter coupon code"
                        error={errors.code}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={generateCode}
                      >
                        Generate
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Title
                    </label>
                    <Input
                      value={formData.title}
                      onChange={(e) => handleChange('title', e.target.value)}
                      placeholder="e.g., 20% Off Room Booking"
                      error={errors.title}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => handleChange('description', e.target.value)}
                      placeholder="Describe what this coupon offers..."
                      className={`input min-h-[80px] ${errors.description ? 'border-red-500' : ''}`}
                    />
                    {errors.description && (
                      <p className="text-red-500 text-xs mt-1">{errors.description}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Category
                    </label>
                    <select
                      value={formData.category}
                      onChange={(e) => handleChange('category', e.target.value)}
                      className="input"
                    >
                      <option value="general">General</option>
                      <option value="room">Room & Accommodation</option>
                      <option value="dining">Dining & Restaurant</option>
                      <option value="spa">Spa & Wellness</option>
                      <option value="experience">Experiences & Activities</option>
                    </select>
                  </div>
                </CardContent>
              </Card>

              {/* Discount Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Discount Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Discount Type
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => handleChange('type', e.target.value)}
                      className="input"
                    >
                      <option value="percentage">Percentage Off</option>
                      <option value="fixed_amount">Fixed Amount Off</option>
                      <option value="free_item">Free Item</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {formData.type === 'percentage' ? 'Percentage (%)' : 
                       formData.type === 'fixed_amount' ? 'Amount ($)' : 'Item Value ($)'}
                    </label>
                    <Input
                      type="number"
                      value={formData.value}
                      onChange={(e) => handleChange('value', e.target.value)}
                      placeholder={formData.type === 'percentage' ? '20' : '50'}
                      min="0"
                      step={formData.type === 'percentage' ? '1' : '0.01'}
                      error={errors.value}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Minimum Spend ($)
                    </label>
                    <Input
                      type="number"
                      value={formData.minSpend}
                      onChange={(e) => handleChange('minSpend', e.target.value)}
                      placeholder="Optional"
                      min="0"
                      step="0.01"
                      error={errors.minSpend}
                    />
                  </div>

                  {formData.type === 'percentage' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Maximum Discount ($)
                      </label>
                      <Input
                        type="number"
                        value={formData.maxDiscount}
                        onChange={(e) => handleChange('maxDiscount', e.target.value)}
                        placeholder="Optional"
                        min="0"
                        step="0.01"
                        error={errors.maxDiscount}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Validity & Usage */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Validity & Usage
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valid From
                    </label>
                    <Input
                      type="datetime-local"
                      value={formData.validFrom}
                      onChange={(e) => handleChange('validFrom', e.target.value)}
                      error={errors.validFrom}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valid Until
                    </label>
                    <Input
                      type="datetime-local"
                      value={formData.validUntil}
                      onChange={(e) => handleChange('validUntil', e.target.value)}
                      error={errors.validUntil}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Usage Limit
                    </label>
                    <Input
                      type="number"
                      value={formData.usageLimit}
                      onChange={(e) => handleChange('usageLimit', e.target.value)}
                      placeholder="Unlimited"
                      min="1"
                      error={errors.usageLimit}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Additional Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    Additional Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Terms & Conditions
                    </label>
                    <textarea
                      value={formData.terms}
                      onChange={(e) => handleChange('terms', e.target.value)}
                      placeholder="Additional terms and conditions..."
                      className="input min-h-[80px]"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={formData.isActive}
                      onChange={(e) => handleChange('isActive', e.target.checked)}
                      className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <label htmlFor="isActive" className="text-sm font-medium text-gray-700">
                      Activate coupon immediately
                    </label>
                  </div>
                </CardContent>
              </Card>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create Coupon'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};