import { createHashRouter } from "react-router-dom";
import { SearchPage } from "./pages/SearchPage";
import { CanvasPage } from "./pages/CanvasPage";

// Hash router keeps the static GitHub Pages deploy working without server rewrites,
// and lets us pack full figure state into the URL for shareable permalinks.
export const router = createHashRouter([
  { path: "/", element: <SearchPage /> },
  { path: "/canvas", element: <CanvasPage /> },
]);
