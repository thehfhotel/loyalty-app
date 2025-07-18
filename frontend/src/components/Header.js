import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Header.css';

const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <Link to="/" className="logo">
            <h1>Hotel Loyalty</h1>
          </Link>
          
          <nav className="nav">
            {user ? (
              <div className="nav-user">
                <span className="user-greeting">
                  Welcome, {user.firstName}!
                </span>
                <div className="user-menu">
                  <Link to="/profile" className="nav-link">Profile</Link>
                  <button onClick={handleLogout} className="btn btn-secondary">
                    Logout
                  </button>
                </div>
              </div>
            ) : (
              <div className="nav-auth">
                <Link to="/login" className="nav-link">Login</Link>
                <Link to="/register" className="btn">Register</Link>
              </div>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;