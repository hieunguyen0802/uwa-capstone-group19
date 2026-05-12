import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Role from "./pages/Role";
import Academic from "./pages/Academic";
import Supervisor from "./pages/Supervisor";
import SchoolofOperations from "./pages/SchoolofOperations";
import HeadofSchool from "./pages/HeadofSchool";
import { AuthProvider } from "./auth/AuthContext";
import RequirePermission from "./auth/RequirePermission";

/**
 * App shell — wraps every route in an AuthProvider so useAuth() works
 * anywhere downstream, and guards each role-specific page with a
 * RequirePermission gate that matches the codename the backend uses
 * in /api/auth/me/'s menu response.
 */
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/role" element={<Role />} />
          <Route
            path="/workload-platform"
            element={
              <RequirePermission permission="api.view_academic_page">
                <Academic />
              </RequirePermission>
            }
          />
          <Route
            path="/department-head"
            element={
              <RequirePermission permission="api.view_hod_page">
                <Supervisor />
              </RequirePermission>
            }
          />
          <Route
            path="/school-operations"
            element={
              <RequirePermission permission="api.view_school_ops_page">
                <SchoolofOperations />
              </RequirePermission>
            }
          />
          <Route
            path="/school-head"
            element={
              <RequirePermission permission="api.view_hos_page">
                <HeadofSchool />
              </RequirePermission>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
