import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { trpc } from '../../utils/trpc';
import DashboardButton from '../../components/navigation/DashboardButton';

// Types
interface RoomType {
  id: string;
  name: string;
  isActive: boolean;
}

interface Room {
  id: string;
  roomNumber: string;
  floor: number | null;
  roomTypeId: string;
  isActive: boolean;
}

interface BlockedDateItem {
  id: string;
  roomId: string;
  blockedDate: string;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface RoomBlockedDates {
  roomId: string;
  roomNumber: string;
  dates: BlockedDateItem[];
}

interface Booking {
  id: string;
  roomId: string;
  checkInDate: string;
  checkOutDate: string;
  status: string;
}

type CellStatus = 'available' | 'blocked' | 'booked';

const RoomAvailability: React.FC = () => {
  const { t } = useTranslation();
  // 'all' means show all room types, otherwise show specific room type
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>('all');
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragMoved, setDragMoved] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [viewedBlockReason, setViewedBlockReason] = useState('');

  // tRPC queries
  const utils = trpc.useUtils();

  const { data: roomTypes } = trpc.booking.admin.getRoomTypes.useQuery(
    { includeInactive: false },
    { refetchOnWindowFocus: false }
  );

  // When 'all' is selected, don't filter by room type (pass undefined)
  const roomTypeFilter = selectedRoomTypeId === 'all' ? undefined : selectedRoomTypeId;

  const { data: rooms } = trpc.booking.admin.getRooms.useQuery(
    { roomTypeId: roomTypeFilter, includeInactive: false },
    { refetchOnWindowFocus: false }
  );

  // Calculate date range for current month view
  const { startDate, endDate, daysInMonth } = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    const days: Date[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    return { startDate: start, endDate: end, daysInMonth: days };
  }, [currentMonth]);

  const { data: blockedDates, isLoading: blockedLoading } = trpc.booking.admin.getAllBlockedDates.useQuery(
    {
      roomTypeId: roomTypeFilter,
      startDate: startDate,
      endDate: endDate,
    },
    { refetchOnWindowFocus: false }
  );

  const { data: bookings, isLoading: bookingsLoading } = trpc.booking.admin.getRoomBookings.useQuery(
    {
      roomTypeId: roomTypeFilter,
      startDate: startDate,
      endDate: endDate,
    },
    { refetchOnWindowFocus: false }
  );

  const blockMutation = trpc.booking.admin.blockDates.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.availability.blockSuccess'));
      utils.booking.admin.getAllBlockedDates.invalidate();
      setShowBlockModal(false);
      setBlockReason('');
      setSelectedCells(new Set());
      setSelectedRoomId(null);
    },
    onError: (error) => {
      toast.error(error.message || t('admin.booking.availability.blockError'));
    },
  });

  const unblockMutation = trpc.booking.admin.unblockDates.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.availability.unblockSuccess'));
      utils.booking.admin.getAllBlockedDates.invalidate();
      setSelectedCells(new Set());
    },
    onError: (error) => {
      toast.error(error.message || t('admin.booking.availability.unblockError'));
    },
  });

  // Build a map of cell statuses
  const cellStatusMap = useMemo(() => {
    const map = new Map<string, { status: CellStatus; reason?: string }>();

    // Mark blocked dates
    if (blockedDates) {
      blockedDates.forEach((roomData: RoomBlockedDates) => {
        roomData.dates.forEach((bd: BlockedDateItem) => {
          // Normalize date format - strip time portion if present (e.g., "2025-01-15T00:00:00.000Z" -> "2025-01-15")
          const normalizedDate = bd.blockedDate.split('T')[0];
          const key = `${bd.roomId}-${normalizedDate}`;
          map.set(key, { status: 'blocked', reason: bd.reason ?? '' });
        });
      });
    }

    // Mark booked dates
    if (bookings) {
      bookings.forEach((booking: Booking) => {
        if (booking.status === 'cancelled') return;

        const checkIn = new Date(booking.checkInDate);
        const checkOut = new Date(booking.checkOutDate);

        for (let d = new Date(checkIn); d < checkOut; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split('T')[0];
          const key = `${booking.roomId}-${dateStr}`;
          // Booked takes precedence over blocked
          map.set(key, { status: 'booked' });
        }
      });
    }

    return map;
  }, [blockedDates, bookings]);

  const getCellStatus = useCallback((roomId: string, date: Date): { status: CellStatus; reason?: string } => {
    const dateStr = date.toISOString().split('T')[0];
    const key = `${roomId}-${dateStr}`;
    return cellStatusMap.get(key) ?? { status: 'available' };
  }, [cellStatusMap]);

  const getCellKey = useCallback((roomId: string, date: Date): string => {
    const dateStr = date.toISOString().split('T')[0];
    return `${roomId}-${dateStr}`;
  }, []);

  const handleCellClick = useCallback((roomId: string, date: Date) => {
    // If we just finished a drag (moved to other cells), don't toggle
    if (dragMoved) {
      return;
    }

    const { status, reason } = getCellStatus(roomId, date);
    const key = getCellKey(roomId, date);

    if (status === 'booked') {
      // Cannot modify booked dates
      toast.error(t('admin.booking.availability.cannotModifyBooked'));
      return;
    }

    if (status === 'blocked') {
      // Show reason and option to unblock
      setViewedBlockReason(reason ?? '');
      setSelectedRoomId(roomId);
      setSelectedCells(new Set([key]));
      setShowReasonModal(true);
      return;
    }

    // For single clicks on available dates, toggle selection
    // But if the cell was just selected by mouseDown (same key as dragStart),
    // keep it selected instead of toggling it off
    if (dragStart === key) {
      // This was a single click - keep the selection from mouseDown
      return;
    }

    // Toggle selection for available dates (Ctrl+click or adding to existing selection)
    setSelectedCells(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
    setSelectedRoomId(roomId);
  }, [getCellStatus, getCellKey, t, dragMoved, dragStart]);

  const handleMouseDown = useCallback((roomId: string, date: Date) => {
    const { status } = getCellStatus(roomId, date);
    if (status !== 'available') return;

    setIsDragging(true);
    setDragMoved(false);
    const key = getCellKey(roomId, date);
    setDragStart(key);
    setSelectedRoomId(roomId);
    setSelectedCells(new Set([key]));
  }, [getCellStatus, getCellKey]);

  const handleMouseEnter = useCallback((roomId: string, date: Date) => {
    if (!isDragging || roomId !== selectedRoomId) return;

    const { status } = getCellStatus(roomId, date);
    if (status !== 'available') return;

    const key = getCellKey(roomId, date);
    setDragMoved(true); // Mark that we've moved during drag
    setSelectedCells(prev => new Set([...prev, key]));
  }, [isDragging, selectedRoomId, getCellStatus, getCellKey]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    // Don't clear dragStart here - it's used by onClick to detect single clicks
    // Clear it after a short delay to allow onClick to check it
    setTimeout(() => {
      setDragStart(null);
      setDragMoved(false);
    }, 0);
  }, []);

  const handleBlockSelected = useCallback(() => {
    if (selectedCells.size === 0 || !selectedRoomId) return;
    setShowBlockModal(true);
  }, [selectedCells, selectedRoomId]);

  const confirmBlock = useCallback(() => {
    if (!selectedRoomId || !blockReason.trim()) return;

    const dates = Array.from(selectedCells).map(key => {
      const dateStr = key.split('-').slice(1).join('-');
      // Use noon UTC to avoid timezone date shift
      return new Date(dateStr + 'T12:00:00Z');
    });

    blockMutation.mutate({
      roomId: selectedRoomId,
      dates,
      reason: blockReason.trim(),
    });
  }, [selectedRoomId, blockReason, selectedCells, blockMutation]);

  const handleUnblockSelected = useCallback(() => {
    if (!selectedRoomId || selectedCells.size === 0) return;

    const dates = Array.from(selectedCells).map(key => {
      const dateStr = key.split('-').slice(1).join('-');
      // Use noon UTC to avoid timezone date shift
      return new Date(dateStr + 'T12:00:00Z');
    });

    unblockMutation.mutate({
      roomId: selectedRoomId,
      dates,
    });
    setShowReasonModal(false);
  }, [selectedRoomId, selectedCells, unblockMutation]);

  const handleClearSelection = useCallback(() => {
    setSelectedCells(new Set());
    setSelectedRoomId(null);
  }, []);

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setSelectedCells(new Set());
  }, []);

  const handleNextMonth = useCallback(() => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setSelectedCells(new Set());
  }, []);

  const formatMonthYear = useCallback((date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, []);

  const getCellClassName = useCallback((roomId: string, date: Date) => {
    const { status } = getCellStatus(roomId, date);
    const key = getCellKey(roomId, date);
    const isSelected = selectedCells.has(key);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPast = date < today;

    let baseClasses = 'w-8 h-8 text-xs flex items-center justify-center cursor-pointer transition-all border';

    if (isSelected) {
      baseClasses += ' ring-2 ring-blue-500 ring-offset-1';
    }

    if (isPast) {
      baseClasses += ' opacity-50';
    }

    switch (status) {
      case 'booked':
        return `${baseClasses} bg-blue-500 text-white border-blue-600 cursor-not-allowed`;
      case 'blocked':
        return `${baseClasses} bg-red-500 text-white border-red-600`;
      default:
        return `${baseClasses} bg-green-100 text-green-800 border-green-300 hover:bg-green-200`;
    }
  }, [getCellStatus, getCellKey, selectedCells]);

  const isLoading = blockedLoading || bookingsLoading;

  return (
    <div className="min-h-screen bg-gray-50" onMouseUp={handleMouseUp}>
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {t('admin.booking.availability.title')}
              </h1>
              <p className="text-gray-600 mt-1">
                {t('admin.booking.availability.subtitle')}
              </p>
            </div>
            <DashboardButton variant="outline" size="md" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto p-4">
        {/* Controls */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            {/* Room Type Selector */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">
                {t('admin.booking.availability.selectRoomType')}:
              </label>
              <select
                value={selectedRoomTypeId}
                onChange={(e) => {
                  setSelectedRoomTypeId(e.target.value);
                  setSelectedCells(new Set());
                  setSelectedRoomId(null);
                }}
                className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">{t('admin.booking.availability.allRoomTypes')}</option>
                {roomTypes?.map((rt: RoomType) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Month Navigation */}
            {selectedRoomTypeId && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={handlePrevMonth}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                  {t('common.previous')}
                </button>
                <span className="text-lg font-medium min-w-[160px] text-center">
                  {formatMonthYear(currentMonth)}
                </span>
                <button
                  onClick={handleNextMonth}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                  {t('common.next')}
                </button>
              </div>
            )}

            {/* Selection Actions */}
            {selectedCells.size > 0 && selectedRoomId && (
              <div className="flex items-center space-x-2 ml-auto">
                <span className="text-sm text-gray-600">
                  {t('admin.booking.availability.selectedDates', { count: selectedCells.size })}
                </span>
                <button
                  onClick={handleBlockSelected}
                  className="px-3 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700"
                >
                  {t('admin.booking.availability.blockSelected')}
                </button>
                <button
                  onClick={handleClearSelection}
                  className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
                >
                  {t('admin.booking.availability.clearSelection')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        {selectedRoomTypeId && (
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-green-100 border border-green-300 rounded" />
                <span className="text-sm text-gray-700">{t('admin.booking.availability.available')}</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-red-500 border border-red-600 rounded" />
                <span className="text-sm text-gray-700">{t('admin.booking.availability.blocked')}</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-blue-500 border border-blue-600 rounded" />
                <span className="text-sm text-gray-700">{t('admin.booking.availability.booked')}</span>
              </div>
              <div className="text-sm text-gray-500 ml-auto">
                {t('admin.booking.availability.dragHint')}
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/4" />
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-gray-200 rounded" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Calendar Grid */}
        {!isLoading && rooms && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10 min-w-[120px]">
                      {t('admin.booking.availability.room')}
                    </th>
                    {daysInMonth.map((date) => (
                      <th
                        key={date.toISOString()}
                        className="px-1 py-3 text-center text-xs font-medium text-gray-500"
                      >
                        <div>{date.getDate()}</div>
                        <div className="text-[10px] text-gray-400">
                          {date.toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {rooms.length === 0 ? (
                    <tr>
                      <td colSpan={daysInMonth.length + 1} className="px-6 py-12 text-center">
                        <div className="text-gray-500">
                          <p className="text-lg font-medium">{t('admin.booking.availability.noRooms')}</p>
                          <p className="text-sm mt-1">{t('admin.booking.availability.noRoomsDescription')}</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    rooms.map((room: Room) => (
                      <tr key={room.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 whitespace-nowrap sticky left-0 bg-white z-10">
                          <div className="text-sm font-medium text-gray-900">
                            {room.roomNumber}
                          </div>
                          {room.floor && (
                            <div className="text-xs text-gray-500">
                              {t('admin.booking.availability.floor')} {room.floor}
                            </div>
                          )}
                        </td>
                        {daysInMonth.map((date) => (
                          <td
                            key={date.toISOString()}
                            className="px-1 py-2"
                          >
                            <div
                              className={getCellClassName(room.id, date)}
                              onClick={() => handleCellClick(room.id, date)}
                              onMouseDown={() => handleMouseDown(room.id, date)}
                              onMouseEnter={() => handleMouseEnter(room.id, date)}
                              title={getCellStatus(room.id, date).reason ?? getCellStatus(room.id, date).status}
                            >
                              {date.getDate()}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Block Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('admin.booking.availability.blockDates')}</h2>
                <button
                  onClick={() => {
                    setShowBlockModal(false);
                    setBlockReason('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  X
                </button>
              </div>

              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm text-yellow-800">
                  {t('admin.booking.availability.blockingInfo', { count: selectedCells.size })}
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('admin.booking.availability.blockReason')} *
                </label>
                <input
                  type="text"
                  required
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder={t('admin.booking.availability.blockReasonPlaceholder')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowBlockModal(false);
                    setBlockReason('');
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={confirmBlock}
                  disabled={blockMutation.isPending || !blockReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  {blockMutation.isPending ? t('common.processing') : t('admin.booking.availability.confirmBlock')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Blocked Reason Modal */}
      {showReasonModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('admin.booking.availability.blockedDate')}</h2>
                <button
                  onClick={() => {
                    setShowReasonModal(false);
                    setViewedBlockReason('');
                    setSelectedCells(new Set());
                    setSelectedRoomId(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  X
                </button>
              </div>

              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm font-medium text-red-800 mb-1">
                  {t('admin.booking.availability.blockReason')}:
                </p>
                <p className="text-sm text-red-700">{viewedBlockReason || '-'}</p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowReasonModal(false);
                    setViewedBlockReason('');
                    setSelectedCells(new Set());
                    setSelectedRoomId(null);
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  {t('common.close')}
                </button>
                <button
                  onClick={handleUnblockSelected}
                  disabled={unblockMutation.isPending}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                  {unblockMutation.isPending ? t('common.processing') : t('admin.booking.availability.unblock')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomAvailability;
