import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminRoot } from './AdminRoot';
import { CreatorPage } from './creator/CreatorPage';
import './style.css';
import './extra.css';

// /c#<token> is a creator's private link; everything else is the admin app.
const isCreator = window.location.pathname.replace(/\/+$/, '') === '/c';
createRoot(document.getElementById('root')!).render(isCreator ? <CreatorPage /> : <AdminRoot />);
