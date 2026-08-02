const routes = [
  { x: 78, y: 76, width: 148, title: "/", meta: "Home · clean", tone: "green" },
  {
    x: 282,
    y: 42,
    width: 170,
    title: "/customers",
    meta: "12 components",
    tone: "green",
  },
  {
    x: 506,
    y: 103,
    width: 185,
    title: "/customers/[id]",
    meta: "1 finding",
    tone: "orange",
  },
  {
    x: 170,
    y: 238,
    width: 162,
    title: "/jobs",
    meta: "3 states",
    tone: "green",
  },
  {
    x: 410,
    y: 263,
    width: 185,
    title: "/jobs/[id]",
    meta: "2 notes",
    tone: "orange",
  },
];

export function RouteField() {
  return (
    <figure
      className="route-field"
      aria-label="Topo application atlas showing connected application routes"
    >
      <div className="field-toolbar">
        <span className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>field-service-app</span>
        <span className="field-sync">
          <i /> graph current
        </span>
      </div>
      <svg
        className="route-field-svg"
        viewBox="0 0 760 420"
        role="img"
        aria-labelledby="route-field-title"
      >
        <title id="route-field-title">
          Application routes connected across a topographic canvas
        </title>
        <defs>
          <pattern
            id="minor-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.6"
            />
          </pattern>
          <filter
            id="field-shadow"
            x="-20%"
            y="-20%"
            width="140%"
            height="150%"
          >
            <feDropShadow dx="0" dy="8" stdDeviation="8" floodOpacity="0.12" />
          </filter>
        </defs>
        <rect
          width="760"
          height="420"
          className="field-grid"
          fill="url(#minor-grid)"
        />
        <g className="contours" fill="none">
          <path d="M-30 337C73 274 87 357 181 326s112-104 208-70 139 15 213-46 147-29 193-4" />
          <path d="M-23 366c111-66 131 16 224-19s109-85 203-50 142 7 216-48 130-31 181-11" />
          <path d="M432-15c12 62 78 58 97 111s-17 84 34 117 106 8 141 58 0 108 55 140" />
          <path d="M476-22c9 54 73 62 87 111s-20 78 31 111 108 13 137 57-2 100 42 133" />
        </g>
        <g className="route-connections" fill="none">
          <path d="M226 108C255 107 255 86 282 85" />
          <path d="M452 86C478 86 482 136 506 139" />
          <path d="M152 124C151 176 231 181 245 238" />
          <path d="M332 278C360 278 374 298 410 300" />
          <path d="M596 179C628 214 600 271 595 301" />
        </g>
        {routes.map((route) => (
          <g
            key={route.title}
            transform={`translate(${route.x} ${route.y})`}
            className={`route-node route-${route.tone}`}
            filter="url(#field-shadow)"
          >
            <rect width={route.width} height="72" rx="3" />
            <rect
              x="10"
              y="11"
              width="26"
              height="21"
              rx="2"
              className="node-preview"
            />
            <path d="M15 25l5-5 4 4 7-8" className="node-preview-line" />
            <text x="46" y="26" className="node-title">
              {route.title}
            </text>
            <text x="12" y="53" className="node-meta">
              {route.meta}
            </text>
            <circle
              cx={route.width - 13}
              cy="14"
              r="4"
              className="node-status"
            />
          </g>
        ))}
      </svg>
      <div className="field-legend">
        <span>
          <i className="legend-route" /> 5 routes
        </span>
        <span>
          <i className="legend-finding" /> 1 finding
        </span>
        <span>
          <i className="legend-note" /> 2 notes
        </span>
      </div>
    </figure>
  );
}
