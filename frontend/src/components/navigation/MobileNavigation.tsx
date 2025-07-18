import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, 
  Award, 
  Ticket, 
  ClipboardList, 
  User 
} from 'lucide-react';
import { clsx } from 'clsx';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
}

const navItems: NavItem[] = [
  {
    to: '/dashboard',
    icon: Home,
    label: 'Home',
  },
  {
    to: '/loyalty',
    icon: Award,
    label: 'Loyalty',
  },
  {
    to: '/coupons',
    icon: Ticket,
    label: 'Coupons',
  },
  {
    to: '/surveys',
    icon: ClipboardList,
    label: 'Surveys',
  },
  {
    to: '/profile',
    icon: User,
    label: 'Profile',
  },
];

export const MobileNavigation: React.FC = () => {
  return (
    <nav className="mobile-only bg-white border-t border-gray-200 safe-bottom">
      <div className="flex">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'flex-1 flex flex-col items-center justify-center py-2 px-1 tap-target relative',
                'text-gray-600 hover:text-primary-600 transition-colors duration-200',
                isActive && 'text-primary-600'
              )
            }
          >
            {({ isActive }) => (
              <>
                <div className="relative">
                  <item.icon 
                    className={clsx(
                      'w-5 h-5 mb-1',
                      isActive && 'text-primary-600'
                    )} 
                  />
                  {item.badge && item.badge > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </div>
                <span 
                  className={clsx(
                    'text-xs font-medium',
                    isActive && 'text-primary-600'
                  )}
                >
                  {item.label}
                </span>
                {isActive && (
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-8 h-0.5 bg-primary-600 rounded-full" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};