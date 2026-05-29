import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "@/components/error-boundary";
import { IntroSplash } from "@/components/ui/intro-splash";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <IntroSplash />
    <App />
  </ErrorBoundary>,
);
