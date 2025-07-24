import { FaFacebook } from 'react-icons/fa';

interface FacebookLoginButtonProps {
  onSuccess?: () => void;
  onFailure?: () => void;
}

export default function FacebookLoginButton({ }: FacebookLoginButtonProps) {
  const handleFacebookClick = () => {
    // Redirect to backend OAuth endpoint using environment variable
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
    window.location.href = `${apiUrl}/oauth/facebook`;
  };

  return (
    <button
      onClick={handleFacebookClick}
      className="w-full flex justify-center items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
    >
      <FaFacebook className="h-5 w-5 text-blue-600 mr-2" />
      Continue with Facebook
    </button>
  );
}