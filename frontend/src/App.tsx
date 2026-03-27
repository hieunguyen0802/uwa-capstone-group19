import { useEffect, useState } from "react";

type Staff = {
  id: number;
  name: string;
  role: string;
  workload: number;
};

function App() {
  const [staff, setStaff] = useState<Staff[]>([]);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/staff/")
      .then((res) => res.json())
      .then((data) => setStaff(data));
  }, []);

  return (
    <div>
      <h1>Staff List</h1>
      {staff.map((s) => (
        <div key={s.id}>
          {s.name} - {s.role} - {s.workload}
        </div>
      ))}
    </div>
  );
}

export default App;