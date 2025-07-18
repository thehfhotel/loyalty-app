import React from 'react';

const ErrorAlert = ({ error, onClose }) => {
  if (!error) return null;

  return (
    <div className="error-alert">
      <div className="error-content">
        <h4>
          {error.isBlocked ? '🚫 Request Blocked' : '❌ Error'}
        </h4>
        <p className="error-message">{error.message}</p>
        
        {error.suggestions && (
          <div className="error-suggestions">
            <p><strong>Try these solutions:</strong></p>
            <ul>
              {error.suggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
          </div>
        )}
        
        {error.isBlocked && (
          <div className="error-help">
            <p><strong>Most common cause:</strong> Ad blockers (like uBlock Origin, AdBlock Plus) often block requests to localhost during development.</p>
          </div>
        )}
        
        <button onClick={onClose} className="error-close">
          ✕ Close
        </button>
      </div>
      
      <style jsx>{`
        .error-alert {
          position: fixed;
          top: 20px;
          right: 20px;
          max-width: 400px;
          background: #fee;
          border: 1px solid #fcc;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          z-index: 1000;
          animation: slideIn 0.3s ease-out;
        }
        
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        
        .error-content h4 {
          margin: 0 0 8px 0;
          color: #c53030;
          font-size: 16px;
        }
        
        .error-message {
          margin: 0 0 12px 0;
          color: #742a2a;
          font-weight: 500;
        }
        
        .error-suggestions {
          margin: 12px 0;
          padding: 12px;
          background: #fff5f5;
          border-radius: 4px;
          border-left: 4px solid #fc8181;
        }
        
        .error-suggestions p {
          margin: 0 0 8px 0;
          font-weight: 600;
          color: #c53030;
        }
        
        .error-suggestions ul {
          margin: 0;
          padding-left: 20px;
        }
        
        .error-suggestions li {
          margin: 4px 0;
          color: #742a2a;
          font-size: 14px;
        }
        
        .error-help {
          margin: 12px 0;
          padding: 8px;
          background: #fffaf0;
          border-radius: 4px;
          border-left: 4px solid #ed8936;
        }
        
        .error-help p {
          margin: 0;
          color: #744210;
          font-size: 13px;
        }
        
        .error-close {
          position: absolute;
          top: 8px;
          right: 8px;
          background: none;
          border: none;
          color: #c53030;
          cursor: pointer;
          font-size: 16px;
          padding: 4px;
        }
        
        .error-close:hover {
          background: #fed7d7;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

export default ErrorAlert;