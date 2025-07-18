import React from 'react';
import { clsx } from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'tier';
  tier?: 'bronze' | 'silver' | 'gold' | 'platinum';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  tier,
  size = 'md',
  className = '',
}) => {
  const baseClasses = 'inline-flex items-center font-medium rounded-full';
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };
  
  const variantClasses = {
    default: 'bg-gray-100 text-gray-800',
    secondary: 'bg-secondary-100 text-secondary-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    tier: '', // Will be handled by tier-specific classes
  };
  
  const tierClasses = {
    bronze: 'tier-bronze',
    silver: 'tier-silver',
    gold: 'tier-gold',
    platinum: 'tier-platinum',
  };
  
  const classes = clsx(
    baseClasses,
    sizeClasses[size],
    variant === 'tier' && tier ? tierClasses[tier] : variantClasses[variant],
    className
  );
  
  return (
    <span className={classes}>
      {children}
    </span>
  );
};