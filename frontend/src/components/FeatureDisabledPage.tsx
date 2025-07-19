import { Link } from 'react-router-dom';
import { FiAlertCircle, FiArrowLeft } from 'react-icons/fi';

interface FeatureDisabledPageProps {
  featureName: string;
  description?: string;
  backLink?: string;
  backLinkText?: string;
}

export default function FeatureDisabledPage({
  featureName,
  description = 'This feature is currently disabled by the system administrator.',
  backLink = '/dashboard',
  backLinkText = 'Back to Dashboard'
}: FeatureDisabledPageProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="text-center">
            <FiAlertCircle className="mx-auto h-12 w-12 text-orange-500" />
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              Feature Unavailable
            </h2>
            <p className="mt-2 text-lg text-gray-600">
              {featureName}
            </p>
            <p className="mt-4 text-sm text-gray-500">
              {description}
            </p>
          </div>
          
          <div className="mt-8">
            <Link
              to={backLink}
              className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <FiArrowLeft className="mr-2 h-4 w-4" />
              {backLinkText}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}