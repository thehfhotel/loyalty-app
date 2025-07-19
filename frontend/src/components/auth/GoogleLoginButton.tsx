import { FaGoogle } from 'react-icons/fa';

interface GoogleLoginButtonProps {
  onSuccess?: () => void;
  onFailure?: () => void;
}

export default function GoogleLoginButton({ onSuccess, onFailure }: GoogleLoginButtonProps) {
  const handleGoogleClick = () => {
    // Redirect to backend OAuth endpoint
    window.location.href = 'http://localhost:4000/api/oauth/google';
  };

  return (
    <button
      onClick={handleGoogleClick}
      className="w-full flex justify-center items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
    >
      <FaGoogle className="h-5 w-5 text-red-500 mr-2" />
      Continue with Google
    </button>
  );
}