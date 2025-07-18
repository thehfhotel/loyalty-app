import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';

const ProfilePage: React.FC = () => {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
      <Card>
        <CardHeader>
          <CardTitle>Profile Page</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Profile management functionality will be implemented in Phase 2.1</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProfilePage;