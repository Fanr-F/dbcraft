import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { createLogger } from './logging';
import './styles.css';

const log = createLogger('renderer');

log.info('渲染进程已加载', { page: window.location.pathname });

window.addEventListener('error', (event) => {
  log.error('未捕获错误', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  log.error('未处理的 Promise 拒绝', {
    reason: event.reason instanceof Error ? event.reason.message : String(event.reason),
  });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
