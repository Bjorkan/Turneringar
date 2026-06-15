import React from "react";
import { createRoot } from "react-dom/client";
import { TvApp } from "./TvApp";

createRoot(document.getElementById("tv-stage") as HTMLElement).render(
  <React.StrictMode>
    <TvApp />
  </React.StrictMode>,
);
