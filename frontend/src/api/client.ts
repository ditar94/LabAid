import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const url = err.config?.url || "";
      const isAuthCheck = url.includes("/auth/me") || url.includes("/auth/login");
      const publicPaths = ["/login", "/setup", "/set-password", "/terms"];
      if (!isAuthCheck && !publicPaths.includes(window.location.pathname)) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;
