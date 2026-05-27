import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import '@openuidev/react-ui/defaults.css';
import '@openuidev/react-ui/components.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
