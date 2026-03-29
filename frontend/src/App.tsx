import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Role from "./pages/Role";
import Academic from "./pages/Academic";
import Supervisor from "./pages/Supervisor";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/role" element={<Role />} />
        <Route path="/academic" element={<Academic />} />
        <Route path="/supervisor" element={<Supervisor />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;