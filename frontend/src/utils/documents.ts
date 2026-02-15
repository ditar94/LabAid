const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

function resolveApiBase(): string {
  if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
    return API_BASE_URL.replace(/\/$/, "");
  }
  const relative = API_BASE_URL.startsWith("/") ? API_BASE_URL : `/${API_BASE_URL}`;
  return relative.replace(/\/$/, "");
}

export async function openDocumentInNewTab(documentId: string): Promise<void> {
  const url = `${resolveApiBase()}/documents/${encodeURIComponent(documentId)}`;
  const newTab = window.open(url, "_blank", "noopener,noreferrer");
  if (!newTab) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }
}
