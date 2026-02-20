import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import DashboardButton from '../../components/navigation/DashboardButton';

// Types based on backend schema
interface Room {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  floor: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  roomType?: {
    id: string;
    name: string;
  };
}

interface RoomType {
  id: string;
  name: string;
  isActive: boolean;
}

interface RoomFormData {
  roomTypeId: string;
  roomNumber: string;
  floor: number | string;
  notes: string;
  isActive: boolean;
}

const initialFormData: RoomFormData = {
  roomTypeId: '',
  roomNumber: '',
  floor: '',
  notes: '',
  isActive: true,
};

const RoomManagement: React.FC = () => {
  const { t } = useTranslation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [formData, setFormData] = useState<RoomFormData>(initialFormData);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [filterRoomTypeId, setFilterRoomTypeId] = useState<string>('');

  // TODO: Replace with REST service when Rust admin booking endpoints are implemented
  const queryClient = useQueryClient();

  const { data: roomTypes } = useQuery<RoomType[]>({
    queryKey: ['admin', 'roomTypes', { includeInactive: true }],
    queryFn: async () => {
      // TODO: Replace with REST service when Rust admin booking endpoints are implemented
      return [];
    },
    refetchOnWindowFocus: false,
  });

  const { data: rooms, isLoading, error } = useQuery<Room[], Error>({
    queryKey: ['admin', 'rooms', { roomTypeId: filterRoomTypeId || undefined, includeInactive: true }],
    queryFn: async () => {
      // TODO: Replace with REST service when Rust admin booking endpoints are implemented
      return [];
    },
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: async (_data: { roomTypeId: string; roomNumber: string; floor?: number; notes?: string; isActive: boolean }) => {
      // TODO: Replace with REST service when Rust admin booking endpoints are implemented
      throw new Error('Admin booking management is being migrated');
    },
    onSuccess: () => {
      toast.success(t('admin.booking.rooms.createSuccess'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'rooms'] });
      setShowCreateModal(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message || t('admin.booking.rooms.createError'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (_data: { id: string; data: { roomTypeId: string; roomNumber: string; floor?: number; notes?: string; isActive: boolean } }) => {
      // TODO: Replace with REST service when Rust admin booking endpoints are implemented
      throw new Error('Admin booking management is being migrated');
    },
    onSuccess: () => {
      toast.success(t('admin.booking.rooms.updateSuccess'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'rooms'] });
      setShowEditModal(false);
      setSelectedRoom(null);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message || t('admin.booking.rooms.updateError'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (_data: { id: string }) => {
      // TODO: Replace with REST service when Rust admin booking endpoints are implemented
      throw new Error('Admin booking management is being migrated');
    },
    onSuccess: () => {
      toast.success(t('admin.booking.rooms.deleteSuccess'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'rooms'] });
      setShowDeleteModal(false);
      setSelectedRoom(null);
      setDeleteConfirmText('');
    },
    onError: (error: Error) => {
      toast.error(error.message || t('admin.booking.rooms.deleteError'));
    },
  });

  const resetForm = useCallback(() => {
    setFormData(initialFormData);
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    // Pre-select the first room type if available
    if (roomTypes && roomTypes.length > 0) {
      const firstRoomType = roomTypes[0];
      if (firstRoomType) {
        setFormData(prev => ({ ...prev, roomTypeId: firstRoomType.id }));
      }
    }
    setShowCreateModal(true);
  }, [resetForm, roomTypes]);

  const handleOpenEdit = useCallback((room: Room) => {
    setSelectedRoom(room);
    setFormData({
      roomTypeId: room.roomTypeId,
      roomNumber: room.roomNumber,
      floor: room.floor ?? '',
      notes: room.notes ?? '',
      isActive: room.isActive,
    });
    setShowEditModal(true);
  }, []);

  const handleOpenDelete = useCallback((room: Room) => {
    setSelectedRoom(room);
    setDeleteConfirmText('');
    setShowDeleteModal(true);
  }, []);

  const handleCreate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      roomTypeId: formData.roomTypeId,
      roomNumber: formData.roomNumber,
      floor: formData.floor !== '' ? Number(formData.floor) : undefined,
      notes: formData.notes || undefined,
      isActive: formData.isActive,
    };
    createMutation.mutate(data);
  }, [formData, createMutation]);

  const handleUpdate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoom) return;

    const data = {
      roomTypeId: formData.roomTypeId,
      roomNumber: formData.roomNumber,
      floor: formData.floor !== '' ? Number(formData.floor) : undefined,
      notes: formData.notes || undefined,
      isActive: formData.isActive,
    };
    updateMutation.mutate({ id: selectedRoom.id, data });
  }, [selectedRoom, formData, updateMutation]);

  const handleDelete = useCallback(() => {
    const deleteKeyword = t('admin.booking.rooms.deleteKeyword');
    if (!selectedRoom || deleteConfirmText !== deleteKeyword) return;
    deleteMutation.mutate({ id: selectedRoom.id });
  }, [selectedRoom, deleteConfirmText, deleteMutation, t]);

  const getRoomTypeName = useCallback((roomTypeId: string) => {
    const roomType = roomTypes?.find((rt: RoomType) => rt.id === roomTypeId);
    return roomType?.name ?? '-';
  }, [roomTypes]);

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
                {t('admin.booking.rooms.title')}
              </h1>
              <p className="text-gray-600 mt-1">
                {t('admin.booking.rooms.subtitle')}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleOpenCreate}
                disabled={!roomTypes || roomTypes.length === 0}
                className="inline-flex items-center font-medium bg-blue-600 text-white px-4 py-2 text-sm rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('admin.booking.rooms.createRoom')}
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-4">
        {/* Filter */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700">
              {t('admin.booking.rooms.filterByType')}:
            </label>
            <select
              value={filterRoomTypeId}
              onChange={(e) => setFilterRoomTypeId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('admin.booking.rooms.allRoomTypes')}</option>
              {roomTypes?.map((rt: RoomType) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </select>
          </div>
        </div>

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

        {(!roomTypes || roomTypes.length === 0) && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex">
              <div className="text-yellow-400 mr-3">!</div>
              <div>
                <h3 className="text-yellow-800 font-medium">{t('admin.booking.rooms.noRoomTypesWarning')}</h3>
                <p className="text-yellow-700 mt-1">{t('admin.booking.rooms.createRoomTypesFirst')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Rooms Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.rooms.roomNumber')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.rooms.floor')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.rooms.roomType')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.rooms.notes')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.rooms.status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('admin.booking.rooms.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {!rooms || rooms.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="text-gray-500">
                        <p className="text-lg font-medium">{t('admin.booking.rooms.noRooms')}</p>
                        <p className="text-sm mt-1">{t('admin.booking.rooms.noRoomsDescription')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rooms.map((room) => (
                    <tr key={room.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {room.roomNumber}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {room.floor ?? '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {getRoomTypeName(room.roomTypeId)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {room.notes ?? '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          room.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {room.isActive ? t('common.active') : t('common.inactive')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleOpenEdit(room as Room)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            onClick={() => handleOpenDelete(room as Room)}
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
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('admin.booking.rooms.createRoom')}</h2>
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
                {/* Room Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.rooms.roomType')} *
                  </label>
                  <select
                    required
                    value={formData.roomTypeId}
                    onChange={(e) => setFormData({ ...formData, roomTypeId: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('admin.booking.rooms.selectRoomType')}</option>
                    {roomTypes?.map((rt: RoomType) => (
                      <option key={rt.id} value={rt.id}>
                        {rt.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Room Number */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.rooms.roomNumber')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.roomNumber}
                    onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                    placeholder={t('admin.booking.rooms.roomNumberPlaceholder')}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Floor */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.rooms.floor')}
                  </label>
                  <input
                    type="number"
                    value={formData.floor}
                    onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                    placeholder={t('admin.booking.rooms.floorPlaceholder')}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.rooms.notes')}
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    placeholder={t('admin.booking.rooms.notesPlaceholder')}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
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
                    {t('admin.booking.rooms.isActive')}
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
      {showEditModal && selectedRoom && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('admin.booking.rooms.editRoom')}</h2>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedRoom(null);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  X
                </button>
              </div>

              <form onSubmit={handleUpdate} className="space-y-4">
                {/* Room Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.rooms.roomType')} *
                  </label>
                  <select
                    required
                    value={formData.roomTypeId}
                    onChange={(e) => setFormData({ ...formData, roomTypeId: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('admin.booking.rooms.selectRoomType')}</option>
                    {roomTypes?.map((rt: RoomType) => (
                      <option key={rt.id} value={rt.id}>
                        {rt.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Room Number */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.rooms.roomNumber')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.roomNumber}
                    onChange={(e) => setFormData({ ...formData, roomNumber: e.target.value })}
                    placeholder={t('admin.booking.rooms.roomNumberPlaceholder')}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Floor */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.rooms.floor')}
                  </label>
                  <input
                    type="number"
                    value={formData.floor}
                    onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                    placeholder={t('admin.booking.rooms.floorPlaceholder')}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('admin.booking.rooms.notes')}
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    placeholder={t('admin.booking.rooms.notesPlaceholder')}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
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
                    {t('admin.booking.rooms.isActive')}
                  </label>
                </div>

                {/* Actions */}
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false);
                      setSelectedRoom(null);
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
      {showDeleteModal && selectedRoom && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-red-600">{t('admin.booking.rooms.deleteRoom')}</h2>
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedRoom(null);
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
                  <span className="font-medium text-red-800">{t('admin.booking.rooms.deleteWarning')}</span>
                </div>
                <div className="text-sm text-red-700">
                  <p className="mb-2">{t('admin.booking.rooms.deleteConfirmText')}:</p>
                  <p className="font-medium">{t('admin.booking.rooms.room')} &quot;{selectedRoom.roomNumber}&quot;</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('admin.booking.rooms.typeToConfirm')} <span className="font-bold text-red-600">{t('admin.booking.rooms.deleteKeyword')}</span> {t('admin.booking.rooms.toConfirm')}:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={t('admin.booking.rooms.deletePlaceholder')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedRoom(null);
                    setDeleteConfirmText('');
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending || deleteConfirmText !== t('admin.booking.rooms.deleteKeyword')}
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

export default RoomManagement;
