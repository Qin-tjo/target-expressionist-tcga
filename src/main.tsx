import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./index.css";

// Note: React.StrictMode intentionally double-mounts components in dev, which
// replays entrance animations twice — omitted so motion plays exactly once.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
