import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Role from "./pages/Role";
import Academic from "./pages/Academic";
import Supervisor from "./pages/Supervisor";
import SchoolofOperations from "./pages/SchoolofOperations";
import HeadofSchool from "./pages/HeadofSchool";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/role" element={<Role />} />
        <Route path="/academic" element={<Academic />} />
        <Route path="/department-head" element={<Supervisor />} />
        <Route path="/school-operations" element={<SchoolofOperations />} />
        <Route path="/school-head" element={<HeadofSchool />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;