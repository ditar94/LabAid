import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  // Attach CSRF token for state-changing requests
  if (config.method && !["get", "head", "options"].includes(config.method)) {
    const csrf = document.cookie
      .split("; ")
      .find((c) => c.startsWith("labaid_csrf="))
      ?.split("=")[1];
    if (csrf) {
      config.headers["X-CSRF-Token"] = csrf;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const url = err.config?.url || "";
      const isAuthCheck = url.includes("/auth/me") || url.includes("/auth/login");
      if (!isAuthCheck && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;
