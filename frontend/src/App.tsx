import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { RequireAuth } from './components/RequireAuth.js';
import { LoginPage } from './pages/LoginPage.js';
import { UploadPage } from './pages/UploadPage.js';
import { FacturasPage } from './pages/FacturasPage.js';
import { FacturaDetallePage } from './pages/FacturaDetallePage.js';
import { ResumenIvaPage } from './pages/ResumenIvaPage.js';
import { ChatPage } from './pages/ChatPage.js';
import { CajaChicaPage } from './pages/CajaChicaPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { AyudaPage } from './pages/AyudaPage.js';
import { HistorialPage } from './pages/HistorialPage.js';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/upload" replace />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/facturas" element={<FacturasPage />} />
        <Route path="/facturas/:id" element={<FacturaDetallePage />} />
        <Route path="/resumen-iva" element={<ResumenIvaPage />} />
        <Route path="/caja-chica" element={<CajaChicaPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/ayuda" element={<AyudaPage />} />
        <Route path="/historial" element={<HistorialPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
