import { useState, useEffect } from "react";
import axios from "axios";

export default function Supervisor() {
  const [data, setData] = useState({
    pending: [],
    approved: [],
    rejected: [],
  });

  const [tab, setTab] = useState("requests");

  const [form, setForm] = useState({
    user_id: "",
    supervisor_id: 1,
    full_name: "",
    unit: "",
    title: "",
    teaching_ratio: 0,
    research_ratio: 0,
    hours: 0,
    semester: "S1",
  });

  const [list, setList] = useState([]);

  //Begin loading
  useEffect(() => {
    // Requests
    axios
      .get("http://localhost:8000/api/supervisor/requests/")
      .then((res) => setData(res.data))
      .catch(() => {
        console.log("Failed to load requests");
      });

    // My submissions
    axios
      .get("http://localhost:8000/api/supervisor/list/")
      .then((res) => setList(res.data))
      .catch(() => {
        console.log("Failed to load list");
      });
  }, []);

  // Submit
  const handleSubmit = async () => {
    try {
      const res = await axios.post(
        "http://localhost:8000/api/supervisor/create/",
        form
      );

      if (res.data.is_sent) {
        alert("✅ Sent successfully");
      } else {
        alert("❌ Failed to send");
      }

      // Fresh list
      const listRes = await axios.get(
        "http://localhost:8000/api/supervisor/list/"
      );
      setList(listRes.data);

      // Clear list
      setForm({
        user_id: "",
        supervisor_id: 1,
        full_name: "",
        unit: "",
        title: "",
        teaching_ratio: 0,
        research_ratio: 0,
        hours: 0,
        semester: "S1",
      });

    } catch (err) {
      console.error(err);
      alert("❌ Failed to create");
    }
  };

  return (
    <div>
      <h1>Supervisor Dashboard</h1>

      {/* TAB */}
      <button onClick={() => setTab("requests")}>Requests</button>
      <button onClick={() => setTab("assign")}>Assign Workload</button>

      {/* ================= REQUESTS ================= */}
      {tab === "requests" && (
        <div>
          <h2>Pending</h2>
          {(data.pending || []).map((item: any) => (
            <div key={item.id}>
              {item.unit} - {item.hours}h
            </div>
          ))}

          <h2>Approved</h2>
          {(data.approved || []).map((item: any) => (
            <div key={item.id}>
              {item.unit} - {item.hours}h
            </div>
          ))}

          <h2>Rejected</h2>
          {(data.rejected || []).map((item: any) => (
            <div key={item.id}>
              {item.unit} - {item.hours}h
            </div>
          ))}
        </div>
      )}

      {/* ================= ASSIGN ================= */}
      {tab === "assign" && (
        <div>
          <h2>Create Workload</h2>

          <input
            placeholder="User ID"
            value={form.user_id}
            onChange={(e) =>
              setForm({ ...form, user_id: e.target.value })
            }
          />

          <input
            placeholder="Full Name"
            value={form.full_name}
            onChange={(e) =>
              setForm({ ...form, full_name: e.target.value })
            }
          />

          <input
            placeholder="Unit"
            value={form.unit}
            onChange={(e) =>
              setForm({ ...form, unit: e.target.value })
            }
          />

          <input
            placeholder="Title"
            value={form.title}
            onChange={(e) =>
              setForm({ ...form, title: e.target.value })
            }
          />

          <input
            placeholder="Teaching Ratio"
            value={form.teaching_ratio}
            onChange={(e) =>
              setForm({
                ...form,
                teaching_ratio: Number(e.target.value),
              })
            }
          />

          <input
            placeholder="Research Ratio"
            value={form.research_ratio}
            onChange={(e) =>
              setForm({
                ...form,
                research_ratio: Number(e.target.value),
              })
            }
          />

          <input
            placeholder="Hours"
            value={form.hours}
            onChange={(e) =>
              setForm({
                ...form,
                hours: Number(e.target.value),
              })
            }
          />

          <select
            value={form.semester}
            onChange={(e) =>
              setForm({ ...form, semester: e.target.value })
            }
          >
            <option value="S1">S1</option>
            <option value="S2">S2</option>
          </select>

          <button onClick={handleSubmit}>Create</button>

          <h2>My Submissions</h2>

          {(list || []).length === 0 && <div>No data</div>}

          {(list || []).map((item: any) => (
            <div
              key={item.id}
              style={{
                border: "1px solid #ccc",
                padding: 10,
                marginBottom: 10,
              }}
            >
              <div>
                <strong>{item.unit}</strong> ({item.hours}h)
              </div>

              <div>
                User: {item.full_name || "Unknown"} | Time:{" "}
                {item.created_at
                  ? new Date(item.created_at).toLocaleString()
                  : "-"}
              </div>

              <div>
                Status: {item.is_sent ? "✅ Sent" : "❌ Failed"}
              </div>

              <div>ID: {item.id}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}