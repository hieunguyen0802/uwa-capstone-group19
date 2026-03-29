import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      const res = await axios.post("http://localhost:8000/login/", {
        email,
        password,
      });

      console.log(res.data);

      localStorage.setItem("user", JSON.stringify(res.data));

      navigate("/role");

    } catch (err) {
      alert("Login failed");
    }
  };

  return (
    <div className="login-container">
      <h1>Workload Verification System</h1>

      <input
        type="text"
        placeholder="Username"
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        placeholder="Password"
        onChange={(e) => setPassword(e.target.value)}
      />

      <button onClick={handleLogin}>Sign In</button>
    </div>
  );
}