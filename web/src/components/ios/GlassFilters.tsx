/**
 * SVG lenses for Liquid Glass refraction. Chromium can run an SVG filter
 * inside backdrop-filter. The displacement map is neutral (128) in the
 * middle of the glass and ramps to 0/255 toward each edge, so content is
 * pulled outward near the rim exactly like a thick convex lens, while the
 * center stays undistorted and legible. Other engines ignore these
 * (glass.css only references them on html[data-engine="chromium"]).
 */
const MAP_X = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22100%22%20height%3D%22100%22%20preserveAspectRatio%3D%22none%22%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%220%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22rgb%280%2C0%2C0%29%22/%3E%3Cstop%20offset%3D%220.16%22%20stop-color%3D%22rgb%28110%2C0%2C0%29%22/%3E%3Cstop%20offset%3D%220.3%22%20stop-color%3D%22rgb%28128%2C0%2C0%29%22/%3E%3Cstop%20offset%3D%220.7%22%20stop-color%3D%22rgb%28128%2C0%2C0%29%22/%3E%3Cstop%20offset%3D%220.84%22%20stop-color%3D%22rgb%28146%2C0%2C0%29%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22rgb%28255%2C0%2C0%29%22/%3E%3C/linearGradient%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20fill%3D%22url%28%23a%29%22/%3E%3C/svg%3E";
const MAP_Y = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22100%22%20height%3D%22100%22%20preserveAspectRatio%3D%22none%22%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22rgb%280%2C0%2C0%29%22/%3E%3Cstop%20offset%3D%220.16%22%20stop-color%3D%22rgb%280%2C110%2C0%29%22/%3E%3Cstop%20offset%3D%220.3%22%20stop-color%3D%22rgb%280%2C128%2C0%29%22/%3E%3Cstop%20offset%3D%220.7%22%20stop-color%3D%22rgb%280%2C128%2C0%29%22/%3E%3Cstop%20offset%3D%220.84%22%20stop-color%3D%22rgb%280%2C146%2C0%29%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22rgb%280%2C255%2C0%29%22/%3E%3C/linearGradient%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20fill%3D%22url%28%23a%29%22/%3E%3C/svg%3E";

function Lens({ id, scale }: { id: string; scale: number }) {
  return (
    <filter id={id} x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
      <feImage href={MAP_X} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mx" />
      <feImage href={MAP_Y} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="my" />
      <feComposite in="mx" in2="my" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="map" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}

export function GlassFilters() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {/* scale is a fraction of the element's box (objectBoundingBox). */}
        <Lens id="halo-lens" scale={0.16} />
        <Lens id="halo-lens-soft" scale={0.05} />
      </defs>
    </svg>
  );
}
