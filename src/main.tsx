import React from 'react';
import { createRoot } from 'react-dom/client';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles.scss';
import './hazards.scss';
import './eva.scss';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
