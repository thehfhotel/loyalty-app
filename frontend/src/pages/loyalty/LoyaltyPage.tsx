import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';

const LoyaltyPage: React.FC = () => {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Loyalty Program</h1>
      <Card>
        <CardHeader>
          <CardTitle>Loyalty Program</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Loyalty points and tiers system will be implemented in Phase 2.2</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoyaltyPage;