import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import { PageStoreProvider } from './context/PageStoreContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import './index.css';

// Provider order matters: SocketProvider needs the token from AuthProvider,
// and the router has to wrap everything that uses <Link> / useNavigate.
//
// PageStoreProvider wraps <App /> itself, NOT a page inside it: the navbar it
// feeds is rendered by App, above <main>, so a provider mounted by a routed page
// would sit below its own consumer and silently do nothing.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthProvider>
        <CartProvider>
          <SocketProvider>
            <PageStoreProvider>
              <App />
            </PageStoreProvider>
          </SocketProvider>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);