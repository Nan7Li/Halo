import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "@fontsource-variable/inter/opsz.css";
import "./styles/tokens.css";
import "./index.css";
import "./vocat.css";
import "./styles/glass.css";
import "./styles/ios.css";
import { installAppearanceRuntime } from "./lib/appearance";

installAppearanceRuntime();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
