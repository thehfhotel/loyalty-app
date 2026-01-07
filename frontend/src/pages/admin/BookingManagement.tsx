import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import {
  FiCalendar,
  FiSearch,
  FiCheck,
  FiX,
  FiAlertTriangle,
  FiClock,
  FiRefreshCw,
  FiChevronUp,
  FiChevronDown
} from 'react-icons/fi';
import DashboardButton from '../../components/navigation/DashboardButton';
import SlipViewerSidebar from '../../components/admin/SlipViewerSidebar';
import BookingEditModal from './BookingEditModal';
import { formatDateToDDMMYYYY, formatDateTimeToEuropean } from '../../utils/dateFormatter';
import { trpc } from '../../hooks/useTRPC';

// Types for booking management
interface BookingUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  membershipId: string | null;
  phone: string | null;
}

interface RoomType {
  id: string;
  name: string;
}

interface BookingSlip {
  id: string;
  imageUrl: string;
  uploadedAt: string;
  slipokStatus: 'pending' | 'verified' | 'failed' | 'quota_exceeded';
  slipokVerifiedAt: string | null;
  adminStatus: 'pending' | 'verified' | 'needs_action';
  adminVerifiedAt: string | null;
  adminVerifiedBy: string | null;
  adminVerifiedByName: string | null;
}

interface BookingAuditEntry {
  id: string;
  action: string;
  adminId: string;
  adminName: string;
  oldValue: string | null;
  newValue: string | null;
  notes: string | null;
  createdAt: string;
}

interface Booking {
  id: string;
  userId: string;
  user: BookingUser;
  roomTypeId: string;
  roomType: RoomType;
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests: number;
  totalPrice: number;
  paymentType: 'full' | 'deposit';
  paymentAmount: number | null;
  discountAmount: number | null;
  discountReason: string | null;
  status: 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
  adminNotes: string | null;
  slip: BookingSlip | null;
  auditHistory: BookingAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

type SortField = 'created_at' | 'check_in_date' | 'room_type';
type SortDirection = 'asc' | 'desc';

const BookingManagement: React.FC = () => {
  const { t } = useTranslation();

  // State management
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [totalBookings, setTotalBookings] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'confirmed' | 'cancelled' | 'completed' | ''>('');

  const pageSize = 10;
  const totalPages = Math.ceil(totalBookings / pageSize);

  // tRPC queries and mutations
  const bookingsQuery = trpc.booking.admin.getAllBookingsAdvanced.useQuery(
    {
      page: currentPage,
      limit: pageSize,
      search: debouncedSearchTerm || undefined,
      status: statusFilter || undefined,
      sortBy: sortField,
      sortOrder: sortDirection
    }
  );

  // Update state when query data changes
  useEffect(() => {
    if (bookingsQuery.data) {
      setBookings(bookingsQuery.data.bookings as unknown as Booking[]);
      setTotalBookings(bookingsQuery.data.total);
      setInitialLoading(false);
      setIsSearching(false);
    }
  }, [bookingsQuery.data]);

  // Handle query error
  useEffect(() => {
    if (bookingsQuery.error) {
      toast.error(t('admin.booking.bookingManagement.errors.loadFailed'));
      setInitialLoading(false);
      setIsSearching(false);
    }
  }, [bookingsQuery.error, t]);

  const verifySlipMutation = trpc.booking.admin.verifySlip.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.bookingManagement.messages.slipVerified'));
      bookingsQuery.refetch();
      if (selectedBooking) {
        // Update selected booking with new data
        const updatedBooking = bookings.find(b => b.id === selectedBooking.id);
        if (updatedBooking) {
          setSelectedBooking(updatedBooking);
        }
      }
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.verifyFailed'));
    }
  });

  const markNeedsActionMutation = trpc.booking.admin.markNeedsAction.useMutation({
    onSuccess: () => {
      toast.success(t('admin.booking.bookingManagement.messages.markedNeedsAction'));
      bookingsQuery.refetch();
    },
    onError: () => {
      toast.error(t('admin.booking.bookingManagement.errors.markFailed'));
    }
  });

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      if (searchTerm !== debouncedSearchTerm) {
        setIsSearching(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, debouncedSearchTerm]);

  // Reset to page 1 when search term changes
  useEffect(() => {
    if (!initialLoading && debouncedSearchTerm !== '') {
      setCurrentPage(1);
    }
  }, [debouncedSearchTerm, initialLoading]);

  // Reset to page 1 when status filter changes
  useEffect(() => {
    if (!initialLoading) {
      setCurrentPage(1);
    }
  }, [statusFilter, initialLoading]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    // Search is automatic via debounce
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleRowClick = (booking: Booking) => {
    setSelectedBooking(booking);
  };

  const handleVerifySlip = async (bookingId: string) => {
    await verifySlipMutation.mutateAsync({ bookingId });
  };

  const handleNeedsAction = async (bookingId: string, notes: string) => {
    await markNeedsActionMutation.mutateAsync({ bookingId, notes });
  };

  const handleEditBooking = (booking: Booking) => {
    setSelectedBooking(booking);
    setShowEditModal(true);
  };

  const handleEditModalClose = () => {
    setShowEditModal(false);
  };

  const handleEditSave = () => {
    bookingsQuery.refetch();
    setShowEditModal(false);
  };

  // Status badge components
  const SlipOkStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const badges: Record<string, { icon: React.ReactNode; text: string; className: string }> = {
      verified: {
        icon: <FiCheck className="w-3 h-3" />,
        text: t('admin.booking.bookingManagement.slipStatus.verified'),
        className: 'bg-green-100 text-green-800'
      },
      failed: {
        icon: <FiAlertTriangle className="w-3 h-3" />,
        text: t('admin.booking.bookingManagement.slipStatus.failed'),
        className: 'bg-red-100 text-red-800'
      },
      pending: {
        icon: <FiClock className="w-3 h-3" />,
        text: t('admin.booking.bookingManagement.slipStatus.pending'),
        className: 'bg-yellow-100 text-yellow-800'
      },
      quota_exceeded: {
        icon: <FiAlertTriangle className="w-3 h-3" />,
        text: t('admin.booking.bookingManagement.slipStatus.quotaExceeded'),
        className: 'bg-orange-100 text-orange-800'
      }
    };

    const badge = badges[status] ?? badges.pending;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${badge?.className ?? ''}`}>
        {badge?.icon}
        {badge?.text}
      </span>
    );
  };

  const AdminStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const badges: Record<string, { icon: React.ReactNode; text: string; className: string }> = {
      verified: {
        icon: <FiCheck className="w-3 h-3" />,
        text: t('admin.booking.bookingManagement.adminStatus.verified'),
        className: 'bg-green-100 text-green-800'
      },
      needs_action: {
        icon: <FiAlertTriangle className="w-3 h-3" />,
        text: t('admin.booking.bookingManagement.adminStatus.needsAction'),
        className: 'bg-orange-100 text-orange-800'
      },
      pending: {
        icon: <FiClock className="w-3 h-3" />,
        text: t('admin.booking.bookingManagement.adminStatus.pending'),
        className: 'bg-yellow-100 text-yellow-800'
      }
    };

    const badge = badges[status] ?? badges.pending;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${badge?.className ?? ''}`}>
        {badge?.icon}
        {badge?.text}
      </span>
    );
  };

  const BookingStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const badges: Record<string, { icon: React.ReactNode; text: string; className: string }> = {
      confirmed: {
        icon: <FiCheck className="w-3 h-3" />,
        text: t('booking.status.confirmed'),
        className: 'bg-green-100 text-green-800'
      },
      cancelled: {
        icon: <FiX className="w-3 h-3" />,
        text: t('booking.status.cancelled'),
        className: 'bg-red-100 text-red-800'
      },
      completed: {
        icon: <FiCheck className="w-3 h-3" />,
        text: t('booking.status.completed'),
        className: 'bg-blue-100 text-blue-800'
      }
    };

    const badge = badges[status] ?? badges.confirmed;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${badge?.className ?? ''}`}>
        {badge?.icon}
        {badge?.text}
      </span>
    );
  };

  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <FiChevronUp className="w-4 h-4" />
    ) : (
      <FiChevronDown className="w-4 h-4" />
    );
  };

  // Loading state
  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-full mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-300 rounded w-64 mb-6" />
            <div className="h-12 bg-gray-300 rounded mb-6" />
            <div className="bg-white rounded-lg shadow p-6">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-16 bg-gray-200 rounded mb-4" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-full mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <FiCalendar className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {t('admin.booking.bookingManagement.title')}
                </h1>
                <p className="text-sm text-gray-600">
                  {t('admin.booking.bookingManagement.subtitle')}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => bookingsQuery.refetch()}
                disabled={bookingsQuery.isRefetching}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                <FiRefreshCw className={`w-4 h-4 mr-2 ${bookingsQuery.isRefetching ? 'animate-spin' : ''}`} />
                {t('common.refresh')}
              </button>
              <DashboardButton variant="outline" size="md" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-full mx-auto p-4">
        <div className="flex gap-6">
          {/* Left: Table Section (70%) */}
          <div className="w-[70%]">
            {/* Search Bar */}
            <div className="bg-white p-6 rounded-lg shadow mb-6">
              <form onSubmit={handleSearch} className="flex gap-4">
                <div className="flex-1 relative">
                  <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder={t('admin.booking.bookingManagement.searchPlaceholder')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                    </div>
                  )}
                </div>
                <div className="w-48">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as 'confirmed' | 'cancelled' | 'completed' | '')}
                    className="w-full py-2 px-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    aria-label={t('admin.booking.bookingManagement.statusFilter')}
                  >
                    <option value="">{t('admin.booking.bookingManagement.allStatuses')}</option>
                    <option value="confirmed">{t('booking.status.confirmed')}</option>
                    <option value="cancelled">{t('booking.status.cancelled')}</option>
                    <option value="completed">{t('booking.status.completed')}</option>
                  </select>
                </div>
              </form>
              <p className="text-xs text-gray-500 mt-2">
                {t('admin.booking.bookingManagement.searchHint')}
              </p>
            </div>

            {/* Bookings Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden relative">
              {isSearching && (
                <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
                  <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        onClick={() => handleSort('created_at')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-1">
                          {t('admin.booking.bookingManagement.table.created')}
                          <SortIcon field="created_at" />
                        </div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.booking.bookingManagement.table.user')}
                      </th>
                      <th
                        onClick={() => handleSort('room_type')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-1">
                          {t('admin.booking.bookingManagement.table.roomType')}
                          <SortIcon field="room_type" />
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('check_in_date')}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-1">
                          {t('admin.booking.bookingManagement.table.dates')}
                          <SortIcon field="check_in_date" />
                        </div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.booking.bookingManagement.table.status')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.booking.bookingManagement.table.payment')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.booking.bookingManagement.table.slipStatus')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.booking.bookingManagement.table.adminStatus')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('admin.booking.bookingManagement.table.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                          {t('admin.booking.bookingManagement.noBookings')}
                        </td>
                      </tr>
                    ) : (
                      bookings.map((booking) => (
                        <tr
                          key={booking.id}
                          onClick={() => handleRowClick(booking)}
                          onDoubleClick={() => handleEditBooking(booking)}
                          className={`hover:bg-gray-50 cursor-pointer ${
                            selectedBooking?.id === booking.id ? 'bg-blue-50' : ''
                          }`}
                        >
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDateTimeToEuropean(booking.createdAt)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {booking.user.firstName && booking.user.lastName
                                ? `${booking.user.firstName} ${booking.user.lastName}`
                                : booking.user.email}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                              {booking.user.membershipId ?? '-'}
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                            {booking.roomType.name}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div>{formatDateToDDMMYYYY(booking.checkInDate)}</div>
                            <div className="text-gray-500">
                              - {formatDateToDDMMYYYY(booking.checkOutDate)}
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <BookingStatusBadge status={booking.status} />
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {booking.paymentType === 'full'
                                ? t('admin.booking.bookingManagement.paymentType.full')
                                : t('admin.booking.bookingManagement.paymentType.deposit')}
                            </div>
                            <div className="text-sm font-medium text-gray-900">
                              {booking.paymentAmount !== null
                                ? `${booking.paymentAmount.toLocaleString()} THB`
                                : '-'}
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            {booking.slip ? (
                              <SlipOkStatusBadge status={booking.slip.slipokStatus} />
                            ) : (
                              <span className="text-xs text-gray-400">
                                {t('admin.booking.bookingManagement.noSlip')}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            {booking.slip ? (
                              <AdminStatusBadge status={booking.slip.adminStatus} />
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm">
                            <div className="flex space-x-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (booking.slip) handleVerifySlip(booking.id);
                                }}
                                disabled={!booking.slip || verifySlipMutation.isPending}
                                className="p-1 text-green-600 hover:text-green-900 disabled:opacity-50 disabled:cursor-not-allowed"
                                title={t('admin.booking.bookingManagement.actions.verify')}
                              >
                                <FiCheck className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (booking.slip) {
                                    const notes = prompt(t('admin.booking.bookingManagement.actions.enterNotes'));
                                    if (notes) handleNeedsAction(booking.id, notes);
                                  }
                                }}
                                disabled={!booking.slip || markNeedsActionMutation.isPending}
                                className="p-1 text-orange-600 hover:text-orange-900 disabled:opacity-50 disabled:cursor-not-allowed"
                                title={t('admin.booking.bookingManagement.actions.needsAction')}
                              >
                                <FiAlertTriangle className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditBooking(booking);
                                }}
                                className="p-1 text-blue-600 hover:text-blue-900"
                                title={t('admin.booking.bookingManagement.actions.edit')}
                              >
                                <FiCalendar className="w-4 h-4" />
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-6">
                <div className="text-sm text-gray-700">
                  {t('admin.booking.bookingManagement.pagination', {
                    current: currentPage,
                    total: totalPages
                  })}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Slip Viewer Sidebar (30%) */}
          <div className="w-[30%]">
            <SlipViewerSidebar
              booking={selectedBooking}
              onVerify={handleVerifySlip}
              onNeedsAction={handleNeedsAction}
              onEdit={handleEditBooking}
              onRefresh={() => bookingsQuery.refetch()}
            />
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && selectedBooking && (
        <BookingEditModal
          booking={selectedBooking}
          isOpen={showEditModal}
          onClose={handleEditModalClose}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
};

export default React.memo(BookingManagement);
