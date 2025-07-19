interface LineLoginButtonProps {
  onSuccess?: () => void;
  onFailure?: () => void;
}

export default function LineLoginButton({ onSuccess, onFailure }: LineLoginButtonProps) {
  const handleLineClick = () => {
    // Redirect to backend OAuth endpoint
    window.location.href = `${import.meta.env.VITE_API_URL}/oauth/line`;
  };

  return (
    <button
      onClick={handleLineClick}
      className="w-full flex justify-center items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
    >
      <div className="h-5 w-5 mr-2 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-green-500">
          <path d="M12 0C5.373 0 0 4.925 0 11c0 2.65.94 5.088 2.51 7.017L.84 22.45c-.203.547.259 1.009.806.806l4.433-1.67C8.088 23.06 10.35 24 13 24c6.627 0 12-4.925 12-11S19.627 0 13 0zm0 20c-2.229 0-4.27-.818-5.853-2.17L4.5 18.6l.77-1.647C3.82 15.27 3 13.229 3 11c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/>
        </svg>
      </div>
      Continue with LINE
    </button>
  );
}