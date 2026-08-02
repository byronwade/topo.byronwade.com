import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

import { App } from "./App";
import { reviewStudio } from "./examples/review-studio";
import { studio } from "./studio-config";
import "./styles.css";

const definition =
  new URLSearchParams(window.location.search).get("studio") === "review"
    ? reviewStudio
    : studio;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App studio={definition} />
  </StrictMode>,
);
