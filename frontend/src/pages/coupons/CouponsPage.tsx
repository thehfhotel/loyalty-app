import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';

const CouponsPage: React.FC = () => {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Coupons</h1>
      <Card>
        <CardHeader>
          <CardTitle>Coupon Management</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Coupon management system will be implemented in Phase 2.3</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default CouponsPage;