import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Role from "./pages/Role";
import Academic from "./pages/Academic";
import Supervisor from "./pages/Supervisor";
import Admin from "./pages/Admin";
import HeadofSchool from "./pages/HeadofSchool";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/role" element={<Role />} />
        <Route path="/academic" element={<Academic />} />
        <Route path="/supervisor" element={<Supervisor />} />
        <Route path="/school-operations" element={<Admin />} />
        <Route path="/schoolofoperations" element={<Navigate to="/school-operations" replace />} />
        <Route path="/admin" element={<Navigate to="/school-operations" replace />} />
        <Route path="/headofschool" element={<HeadofSchool />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;