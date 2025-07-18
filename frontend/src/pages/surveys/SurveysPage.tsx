import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';

const SurveysPage: React.FC = () => {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Surveys</h1>
      <Card>
        <CardHeader>
          <CardTitle>Survey Management</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Survey management system will be implemented in Phase 2.4</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SurveysPage;