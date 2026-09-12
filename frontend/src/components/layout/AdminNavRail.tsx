import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '../ui/cn';

type AdminNavItem = { to: string; labelKey: string };

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { to: '/admin/loyalty', labelKey: 'adminNav.loyalty' },
  { to: '/admin/perks', labelKey: 'adminNav.perks' },
  { to: '/admin/coupons', labelKey: 'adminNav.coupons' },
  { to: '/admin/users', labelKey: 'adminNav.users' },
  { to: '/admin/surveys', labelKey: 'adminNav.surveys' },
  { to: '/admin/rooms', labelKey: 'adminNav.rooms' },
  { to: '/admin/room-types', labelKey: 'adminNav.roomTypes' },
  { to: '/admin/room-availability', labelKey: 'adminNav.availability' },
  { to: '/admin/booking-management', labelKey: 'adminNav.bookings' },
  { to: '/admin/transaction-history', labelKey: 'adminNav.transactions' },
  { to: '/admin/analytics', labelKey: 'adminNav.analytics' },
  { to: '/admin/privacy-requests', labelKey: 'adminNav.privacy' },
  { to: '/admin/email-service', labelKey: 'adminNav.email' },
];

/**
 * Horizontally-scrolling admin section rail, rendered below AdminTopBar.
 * Not sticky — it scrolls away with the page.
 */
export default function AdminNavRail() {
  const { t } = useTranslation();

  return (
    <div
      className="min-h-11 overflow-x-auto border-b border-hairline bg-surface-page [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      data-testid="admin-nav-rail"
    >
      <div
        className="flex gap-2 px-4 py-2 sm:px-6"
        style={{ scrollSnapType: 'x proximity' }}
      >
        {ADMIN_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={{ scrollSnapAlign: 'start' }}
            className={({ isActive }) =>
              cn(
                'flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-hairline bg-surface-card px-4 text-caption',
                isActive && 'border-brand-600 bg-brand-600 text-white',
              )
            }
          >
            {t(item.labelKey)}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
