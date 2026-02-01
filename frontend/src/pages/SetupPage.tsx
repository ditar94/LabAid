import { useState, type FormEvent } from "react";
import api from "../api/client";
import { useNavigate } from "react-router-dom";

export default function SetupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/auth/setup", {
        email,
        password,
        full_name: fullName,
      });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Setup failed");
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>LabAid Setup</h1>
        <p className="subtitle">Create the platform admin account</p>
        {success ? (
          <p className="success">Setup complete! Redirecting to login...</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              placeholder="Your Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            {error && <p className="error">{error}</p>}
            <button type="submit">Create Admin Account</button>
          </form>
        )}
      </div>
    </div>
  );
}
