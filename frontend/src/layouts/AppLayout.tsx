import React from 'react';
import { Outlet } from 'react-router-dom';
import { MobileNavigation } from '../components/navigation/MobileNavigation';
import { DesktopSidebar } from '../components/navigation/DesktopSidebar';
import { Header } from '../components/navigation/Header';

export const AppLayout: React.FC = () => {
  return (
    <div className="h-screen flex bg-gray-50">
      {/* Desktop Sidebar - Hidden on mobile */}
      <DesktopSidebar />
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <Header />
        
        {/* Page Content */}
        <main className="flex-1 overflow-auto safe-bottom">
          <div className="h-full">
            <Outlet />
          </div>
        </main>
        
        {/* Mobile Bottom Navigation */}
        <MobileNavigation />
      </div>
    </div>
  );
};