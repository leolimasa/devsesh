import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import LoginPage from "@/pages/LoginPage"
import RegisterPage from "@/pages/RegisterPage"
import PairPage from "@/pages/PairPage"
import DashboardPage from "@/pages/DashboardPage"
import SessionDetailPage from "@/pages/SessionDetailPage"
import PasskeyManagementPage from "@/pages/PasskeyManagementPage"
import HostsPage from "@/pages/HostsPage"
import AddPasskeyPage from "@/pages/AddPasskeyPage"
import RegisterPasskeyPage from "@/pages/RegisterPasskeyPage"

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token")
  if (!token) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/pair" element={<PairPage />} />
          <Route path="/passkeys/enroll" element={<RegisterPasskeyPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sessions/:id"
            element={
              <ProtectedRoute>
                <SessionDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/passkeys"
            element={
              <ProtectedRoute>
                <PasskeyManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/passkeys/add"
            element={
              <ProtectedRoute>
                <AddPasskeyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hosts"
            element={
              <ProtectedRoute>
                <HostsPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
