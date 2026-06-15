import React from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./AdminApp";

createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
