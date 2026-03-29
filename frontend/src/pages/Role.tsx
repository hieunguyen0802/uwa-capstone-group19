import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Role() {
  const navigate = useNavigate();

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");

    if (user.role === "academic") {
      navigate("/academic");
    } else if (user.role === "supervisor") {
      navigate("/supervisor");
    }
  }, [navigate]);

  return <h1>Loading...</h1>;
}