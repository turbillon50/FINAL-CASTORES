import { Component, type ReactNode } from "react";

type Props = { name?: string; children: ReactNode };
type State = { error: Error | null };

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error(`[TabErrorBoundary] ${this.props.name ?? "tab"} crashed:`, error, info);
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
            {this.state.error.message || "Ocurrió un problema cargando esta pestaña."}
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
