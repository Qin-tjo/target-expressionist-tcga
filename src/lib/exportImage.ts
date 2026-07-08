// Self-contained figure export: serialize the single figure <svg> and rasterize
// it via canvas. No html-to-image / no external font scraping — the figure has no
// external resources, so the canvas is never tainted and PNG export always works.

function resolveThemeVars(svgMarkup: string): string {
  const cs = getComputedStyle(document.documentElement);
  const ink = (cs.getPropertyValue("--ink").trim() || "#111111");
  const paper = (cs.getPropertyValue("--paper").trim() || "#ffffff");
  return svgMarkup
    .replaceAll("var(--ink)", ink)
    .replaceAll("var(--paper)", paper);
}

/** Serialize an <svg> element to a standalone, theme-resolved SVG string. */
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const raw = new XMLSerializer().serializeToString(clone);
  return resolveThemeVars(`<?xml version="1.0" encoding="UTF-8"?>\n${raw}`);
}

function dims(svg: SVGSVGElement): { w: number; h: number } {
  const w = Number(svg.getAttribute("width")) || svg.clientWidth || 920;
  const h = Number(svg.getAttribute("height")) || svg.clientHeight || 480;
  return { w, h };
}

export function downloadSvg(svg: SVGSVGElement, filename: string): void {
  const blob = new Blob([serializeSvg(svg)], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(URL.createObjectURL(blob), filename, true);
}

/** Rasterize the figure SVG to a PNG data URL at `scale`× and download it. */
export async function downloadPng(svg: SVGSVGElement, filename: string, scale = 3): Promise<void> {
  const { w, h } = dims(svg);
  const str = serializeSvg(svg);
  const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("SVG rasterization failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    triggerDownload(canvas.toDataURL("image/png"), filename, false);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function triggerDownload(href: string, filename: string, revoke: boolean): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1000);
}
