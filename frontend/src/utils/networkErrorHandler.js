// Network error handler for common client-side blocking issues
export const handleNetworkError = (error) => {
  if (error.code === 'ERR_BLOCKED_BY_CLIENT') {
    return {
      type: 'BLOCKED_BY_CLIENT',
      message: 'Request blocked by browser extension or ad blocker',
      suggestions: [
        'Disable your ad blocker and try again',
        'Try using an incognito/private browser window',
        'Check if browser extensions are blocking the request',
        'Add localhost:3011 to your ad blocker whitelist'
      ],
      userFriendlyMessage: 'Your browser or an extension is blocking this request. Please disable your ad blocker or try in incognito mode.'
    };
  }
  
  if (error.code === 'ERR_NETWORK') {
    return {
      type: 'NETWORK_ERROR',
      message: 'Network connection failed',
      suggestions: [
        'Check your internet connection',
        'Verify the server is running',
        'Try refreshing the page'
      ],
      userFriendlyMessage: 'Unable to connect to the server. Please check your connection and try again.'
    };
  }
  
  if (error.code === 'ERR_CONNECTION_REFUSED') {
    return {
      type: 'CONNECTION_REFUSED',
      message: 'Server connection refused',
      suggestions: [
        'Check if the server is running',
        'Verify the correct port (3011)',
        'Check firewall settings'
      ],
      userFriendlyMessage: 'Could not connect to the server. Please contact support if the problem persists.'
    };
  }
  
  // Default handling for other network errors
  return {
    type: 'UNKNOWN_NETWORK_ERROR',
    message: error.message || 'An unknown network error occurred',
    suggestions: [
      'Try refreshing the page',
      'Check your internet connection',
      'Contact support if the problem persists'
    ],
    userFriendlyMessage: 'A network error occurred. Please try again.'
  };
};

// Enhanced axios error handler
export const handleAxiosError = (error) => {
  // Network-level errors (blocked by client, connection issues, etc.)
  if (error.code) {
    return handleNetworkError(error);
  }
  
  // HTTP response errors
  if (error.response) {
    return {
      type: 'HTTP_ERROR',
      status: error.response.status,
      message: error.response.data?.message || 'Server error occurred',
      userFriendlyMessage: error.response.data?.message || 'An error occurred. Please try again.'
    };
  }
  
  // Request setup errors
  if (error.request) {
    return {
      type: 'REQUEST_ERROR',
      message: 'Request could not be sent',
      userFriendlyMessage: 'Unable to send request. Please check your connection.'
    };
  }
  
  // Other errors
  return {
    type: 'UNKNOWN_ERROR',
    message: error.message || 'An unknown error occurred',
    userFriendlyMessage: 'An unexpected error occurred. Please try again.'
  };
};