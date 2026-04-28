import { Component, type ErrorInfo, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Global ErrorBoundary
// ---------------------------------------------------------------------------

interface GlobalProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface GlobalState {
  error: Error | null;
}

/**
 * Application-wide error boundary — converts a render-time crash into a
 * visible error screen instead of a blank page. Critical for production UX:
 * if any page or provider throws, the user can SEE the error and recover.
 */
export class ErrorBoundary extends Component<GlobalProps, GlobalState> {
  state: GlobalState = { error: null };

  static getDerivedStateFromError(error: Error): GlobalState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f8f4ef",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            width: "100%",
            background: "#fff",
            border: "1px solid #f0d9a8",
            borderRadius: 16,
            padding: 28,
            boxShadow: "0 6px 24px rgba(0,0,0,0.06)",
          }}
        >
          <h1
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#1a1612",
              marginBottom: 8,
            }}
          >
            Algo salió mal al renderizar esta pantalla
          </h1>
          <p style={{ fontSize: 14, color: "#5b5146", marginBottom: 16 }}>
            La app capturó un error en cliente. Comparte el detalle con el
            equipo técnico:
          </p>
          <pre
            style={{
              fontSize: 12,
              color: "#1a1612",
              background: "#f8f4ef",
              border: "1px solid #e7dccc",
              borderRadius: 10,
              padding: 14,
              maxHeight: 280,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
            }}
          >
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 16,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={this.reset}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #C8952A",
                background: "#C8952A",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #d6c7ad",
                background: "#fff",
                color: "#1a1612",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Recargar la app
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.href = window.location.origin + "/";
                }
              }}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #d6c7ad",
                background: "#fff",
                color: "#1a1612",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// ---------------------------------------------------------------------------
// TabErrorBoundary — local boundary used inside tabs/sections so a single
// crashing tab does not take down its parent page.
// ---------------------------------------------------------------------------

interface TabProps {
  name?: string;
  children: ReactNode;
}

interface TabState {
  error: Error | null;
}

export class TabErrorBoundary extends Component<TabProps, TabState> {
  state: TabState = { error: null };

  static getDerivedStateFromError(error: Error): TabState {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error(
      `[TabErrorBoundary] ${this.props.name ?? "tab"} crashed:`,
      error,
      info,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div
          className="rounded-2xl p-6 text-center"
          style={{
            background: "rgba(239,68,68,0.05)",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          <div className="text-4xl mb-2">⚠️</div>
          <h3 className="font-bold text-base mb-1" style={{ color: "#1a1612" }}>
            Esta sección tuvo un error
          </h3>
          <p className="text-xs mb-3" style={{ color: "rgba(26,22,18,0.55)" }}>
            {this.state.error.message ||
              "Ocurrió un problema cargando esta pestaña."}
          </p>
          <button
            onClick={this.reset}
            className="px-4 py-2 rounded-xl font-bold text-sm text-white"
            style={{ background: "linear-gradient(135deg, #C8952A, #E8A830)" }}
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
