import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const PUBLIC_PATHS = new Set(["/login", "/setup", "/set-password", "/forgot-password", "/terms"]);

let sessionCheckPromise: Promise<boolean> | null = null;

function getAuthCheckUrl(): string {
  if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
    return `${API_BASE_URL.replace(/\/$/, "")}/auth/me`;
  }
  const base = API_BASE_URL.startsWith("/") ? API_BASE_URL : `/${API_BASE_URL}`;
  return `${base}/auth/me`;
}

async function verifySessionStillValid(): Promise<boolean> {
  if (sessionCheckPromise) return sessionCheckPromise;
  sessionCheckPromise = (async () => {
    try {
      const res = await fetch(getAuthCheckUrl(), {
        method: "GET",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      sessionCheckPromise = null;
    }
  })();
  return sessionCheckPromise;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 30_000,
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      const url = err.config?.url || "";
      const isAuthCheck = url.includes("/auth/me") || url.includes("/auth/login") || url.includes("/auth/logout");
      if (!isAuthCheck && !PUBLIC_PATHS.has(window.location.pathname)) {
        const stillValid = await verifySessionStillValid();
        if (!stillValid) {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(err);
  }
);

export default api;
