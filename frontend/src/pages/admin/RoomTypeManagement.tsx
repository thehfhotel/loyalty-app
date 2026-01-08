import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { trpc } from '../../utils/trpc';
import DashboardButton from '../../components/navigation/DashboardButton';

// Types based on backend schema
interface RoomType {
  id: string;
  name: string;
  description: string | null;
  pricePerNight: number;
  maxGuests: number;
  bedType: 'single' | 'double' | 'twin' | 'king' | null;
  amenities: string[];
  images: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface RoomTypeFormData {
  name: string;
  description: string;
  pricePerNight: number;
  maxGuests: number;
  bedType: 'single' | 'double' | 'twin' | 'king' | '';
  amenities: string[];
  images: string[];
  isActive: boolean;
  sortOrder: number;
}

const AMENITIES_OPTIONS = [
  'wifi',
  'airConditioning',
  'minibar',
  'safe',
  'tv',
  'coffeemaker',
  'hairdryer',
  'bathtub',
  'balcony',
  'oceanView',
  'cityView',
  'roomService',
  'laundry',
  'breakfast',
];

const BED_TYPE_OPTIONS = ['single', 'double', 'twin', 'king'] as const;

const initialFormData: RoomTypeFormData = {
  name: '',
  description: '',
  pricePerNight: 0,
  maxGuests: 2,
  bedType: '',
  amenities: [],
  images: [],
  isActive: true,
  sortOrder: 0,
};

const RoomTypeManagement: React.FC = () => {
  const { t } = useTranslation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedRoomType, setSelectedRoomType] = useState<RoomType | null>(null);
  const [formData, setFormData] = useState<RoomTypeFormData>(initialFormData);
  const [imageInput, setImageInput] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // tRPC queries and mutations
  const utils = trpc.useUtils();

  const { data: roomTypes, isLoading, error } = trpc.booking.admin.getRoomTypes.useQuery(
    { includeInactive: true },
    { refetchOnWindowFocus: false }
  );

  const createMutation = trpc.booking.admin.createRoomType.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.roomTypes.createSuccess'));
      utils.booking.admin.getRoomTypes.invalidate();
      setShowCreateModal(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(error.message || t('admin.booking.roomTypes.createError'));
    },
  });

  const updateMutation = trpc.booking.admin.updateRoomType.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.roomTypes.updateSuccess'));
      utils.booking.admin.getRoomTypes.invalidate();
      setShowEditModal(false);
      setSelectedRoomType(null);
      resetForm();
    },
    onError: (error) => {
      toast.error(error.message || t('admin.booking.roomTypes.updateError'));
    },
  });

  const deleteMutation = trpc.booking.admin.deleteRoomType.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.roomTypes.deleteSuccess'));
      utils.booking.admin.getRoomTypes.invalidate();
      setShowDeleteModal(false);
      setSelectedRoomType(null);
      setDeleteConfirmText('');
    },
    onError: (error) => {
      toast.error(error.message || t('admin.booking.roomTypes.deleteError'));
    },
  });

  const resetForm = useCallback(() => {
    setFormData(initialFormData);
    setImageInput('');
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    setShowCreateModal(true);
  }, [resetForm]);

  const handleOpenEdit = useCallback((roomType: RoomType) => {
    setSelectedRoomType(roomType);
    setFormData({
      name: roomType.name,
      description: roomType.description ?? '',
      pricePerNight: roomType.pricePerNight,
      maxGuests: roomType.maxGuests,
      bedType: roomType.bedType ?? '',
      amenities: roomType.amenities || [],
      images: roomType.images || [],
      isActive: roomType.isActive,
      sortOrder: roomType.sortOrder,
    });
    setShowEditModal(true);
  }, []);

  const handleOpenDelete = useCallback((roomType: RoomType) => {
    setSelectedRoomType(roomType);
    setDeleteConfirmText('');
    setShowDeleteModal(true);
  }, []);

  const handleCreate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: formData.name,
      description: formData.description || undefined,
      pricePerNight: formData.pricePerNight,
      maxGuests: formData.maxGuests,
      bedType: formData.bedType || undefined,
      amenities: formData.amenities,
      images: formData.images,
      isActive: formData.isActive,
      sortOrder: formData.sortOrder,
    };
    createMutation.mutate(data as Parameters<typeof createMutation.mutate>[0]);
  }, [formData, createMutation]);

  const handleUpdate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoomType) return;

    const data = {
      name: formData.name,
      description: formData.description || undefined,
      pricePerNight: formData.pricePerNight,
      maxGuests: formData.maxGuests,
      bedType: formData.bedType || undefined,
      amenities: formData.amenities,
      images: formData.images,
      isActive: formData.isActive,
      sortOrder: formData.sortOrder,
    };
    updateMutation.mutate({
      id: selectedRoomType.id,
      data: data as Parameters<typeof updateMutation.mutate>[0]['data']
    });
  }, [selectedRoomType, formData, updateMutation]);

  const handleDelete = useCallback(() => {
    const deleteKeyword = t('admin.booking.roomTypes.deleteKeyword');
    if (!selectedRoomType || deleteConfirmText !== deleteKeyword) return;
    deleteMutation.mutate({ id: selectedRoomType.id });
  }, [selectedRoomType, deleteConfirmText, deleteMutation, t]);

  const handleAddImage = useCallback(() => {
    if (imageInput.trim() && !formData.images.includes(imageInput.trim())) {
      setFormData(prev => ({
        ...prev,
        images: [...prev.images, imageInput.trim()],
      }));
      setImageInput('');
    }
  }, [imageInput, formData.images]);

  const handleRemoveImage = useCallback((imageUrl: string) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.filter(img => img !== imageUrl),
    }));
  }, []);

  const handleAmenityToggle = useCallback((amenity: string) => {
    setFormData(prev => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter(a => a !== amenity)
        : [...prev.amenities, amenity],
    }));
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/4" />
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-16 bg-gray-200 rounded" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {t('admin.booking.roomTypes.title')}
              </h1>
              <p className="text-gray-600 mt-1">
                {t('admin.booking.roomTypes.subtitle')}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleOpenCreate}
                className="inline-flex items-center font-medium bg-blue-600 text-white px-4 py-2 text-sm rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {t('admin.booking.roomTypes.createRoomType')}
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex">
              <div className="text-red-400 mr-3">!</div>
              <div>
                <h3 className="text-red-800 font-medium">{t('common.error')}</h3>
                <p className="text-red-700 mt-1">{error.message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Room Types Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.roomTypes.name')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.roomTypes.pricePerNight')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.roomTypes.maxGuests')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.roomTypes.bedType')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.roomTypes.status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.roomTypes.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {!roomTypes || roomTypes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="text-gray-500">
                        <p className="text-lg font-medium">{t('admin.booking.roomTypes.noRoomTypes')}</p>
                        <p className="text-sm mt-1">{t('admin.booking.roomTypes.noRoomTypesDescription')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  roomTypes.map((roomType) => (
                    <tr key={roomType.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {roomType.name}
                          </div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">
                            {roomType.description}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {formatCurrency(roomType.pricePerNight)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {roomType.maxGuests} {t('admin.booking.roomTypes.guests')}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {roomType.bedType ? t(`admin.booking.roomTypes.bedTypes.${roomType.bedType}`) : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          roomType.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {roomType.isActive ? t('common.active') : t('common.inactive')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleOpenEdit(roomType as RoomType)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            onClick={() => handleOpenDelete(roomType as RoomType)}
                            className="text-red-600 hover:text-red-900"
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('admin.booking.roomTypes.createRoomType')}</h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  X
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.roomTypes.name')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.roomTypes.description')}
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Price and Max Guests */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.booking.roomTypes.pricePerNight')} (THB) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={formData.pricePerNight}
                      onChange={(e) => setFormData({ ...formData, pricePerNight: parseFloat(e.target.value) || 0 })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.booking.roomTypes.maxGuests')} *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formData.maxGuests}
                      onChange={(e) => setFormData({ ...formData, maxGuests: parseInt(e.target.value) || 1 })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Bed Type and Sort Order */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.booking.roomTypes.bedType')}
                    </label>
                    <select
                      value={formData.bedType}
                      onChange={(e) => setFormData({ ...formData, bedType: e.target.value as typeof formData.bedType })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">{t('admin.booking.roomTypes.selectBedType')}</option>
                      {BED_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {t(`admin.booking.roomTypes.bedTypes.${type}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.booking.roomTypes.sortOrder')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.sortOrder}
                      onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Amenities */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('admin.booking.roomTypes.amenities')}
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {AMENITIES_OPTIONS.map((amenity) => (
                      <label key={amenity} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.amenities.includes(amenity)}
                          onChange={() => handleAmenityToggle(amenity)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">
                          {t(`admin.booking.roomTypes.amenitiesList.${amenity}`)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Images */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.roomTypes.images')}
                  </label>
                  <div className="flex space-x-2 mb-2">
                    <input
                      type="url"
                      value={imageInput}
                      onChange={(e) => setImageInput(e.target.value)}
                      placeholder={t('admin.booking.roomTypes.imageUrlPlaceholder')}
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddImage}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                    >
                      {t('admin.booking.roomTypes.addImage')}
                    </button>
                  </div>
                  {formData.images.length > 0 && (
                    <div className="space-y-2">
                      {formData.images.map((url, index) => (
                        <div key={index} className="flex items-center space-x-2 bg-gray-50 p-2 rounded">
                          <span className="text-sm text-gray-600 truncate flex-1">{url}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(url)}
                            className="text-red-500 hover:text-red-700"
                          >
                            {t('common.remove')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Active Toggle */}
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="isActive" className="text-sm text-gray-700">
                    {t('admin.booking.roomTypes.isActive')}
                  </label>
                </div>

                {/* Actions */}
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      resetForm();
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createMutation.isPending ? t('common.processing') : t('common.create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && selectedRoomType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('admin.booking.roomTypes.editRoomType')}</h2>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedRoomType(null);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  X
                </button>
              </div>

              <form onSubmit={handleUpdate} className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.roomTypes.name')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.roomTypes.description')}
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Price and Max Guests */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.booking.roomTypes.pricePerNight')} (THB) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={formData.pricePerNight}
                      onChange={(e) => setFormData({ ...formData, pricePerNight: parseFloat(e.target.value) || 0 })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.booking.roomTypes.maxGuests')} *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formData.maxGuests}
                      onChange={(e) => setFormData({ ...formData, maxGuests: parseInt(e.target.value) || 1 })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Bed Type and Sort Order */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.booking.roomTypes.bedType')}
                    </label>
                    <select
                      value={formData.bedType}
                      onChange={(e) => setFormData({ ...formData, bedType: e.target.value as typeof formData.bedType })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">{t('admin.booking.roomTypes.selectBedType')}</option>
                      {BED_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {t(`admin.booking.roomTypes.bedTypes.${type}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('admin.booking.roomTypes.sortOrder')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.sortOrder}
                      onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Amenities */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('admin.booking.roomTypes.amenities')}
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {AMENITIES_OPTIONS.map((amenity) => (
                      <label key={amenity} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.amenities.includes(amenity)}
                          onChange={() => handleAmenityToggle(amenity)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">
                          {t(`admin.booking.roomTypes.amenitiesList.${amenity}`)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Images */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.roomTypes.images')}
                  </label>
                  <div className="flex space-x-2 mb-2">
                    <input
                      type="url"
                      value={imageInput}
                      onChange={(e) => setImageInput(e.target.value)}
                      placeholder={t('admin.booking.roomTypes.imageUrlPlaceholder')}
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddImage}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                    >
                      {t('admin.booking.roomTypes.addImage')}
                    </button>
                  </div>
                  {formData.images.length > 0 && (
                    <div className="space-y-2">
                      {formData.images.map((url, index) => (
                        <div key={index} className="flex items-center space-x-2 bg-gray-50 p-2 rounded">
                          <span className="text-sm text-gray-600 truncate flex-1">{url}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(url)}
                            className="text-red-500 hover:text-red-700"
                          >
                            {t('common.remove')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Active Toggle */}
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isActiveEdit"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="isActiveEdit" className="text-sm text-gray-700">
                    {t('admin.booking.roomTypes.isActive')}
                  </label>
                </div>

                {/* Actions */}
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false);
                      setSelectedRoomType(null);
                      resetForm();
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={updateMutation.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {updateMutation.isPending ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedRoomType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-red-600">{t('admin.booking.roomTypes.deleteRoomType')}</h2>
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedRoomType(null);
                    setDeleteConfirmText('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  X
                </button>
              </div>

              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <div className="flex items-center mb-2">
                  <span className="text-red-500 mr-2">!</span>
                  <span className="font-medium text-red-800">{t('admin.booking.roomTypes.deleteWarning')}</span>
                </div>
                <div className="text-sm text-red-700">
                  <p className="mb-2">{t('admin.booking.roomTypes.deleteConfirmText')}:</p>
                  <p className="font-medium">&quot;{selectedRoomType.name}&quot;</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('admin.booking.roomTypes.typeToConfirm')} <span className="font-bold text-red-600">{t('admin.booking.roomTypes.deleteKeyword')}</span> {t('admin.booking.roomTypes.toConfirm')}:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={t('admin.booking.roomTypes.deletePlaceholder')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedRoomType(null);
                    setDeleteConfirmText('');
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending || deleteConfirmText !== t('admin.booking.roomTypes.deleteKeyword')}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleteMutation.isPending ? t('common.processing') : t('common.delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomTypeManagement;
