# Third-party notices

The frontend bundle served to the browser includes the open-source packages below. No third-party
branding, logos, fonts or images are shown in the UI. Icons are drawn with lucide-react.

| Package | Version | License |
|---|---|---|
| echarts (Apache ECharts) | 6.1.0 | Apache-2.0 |
| zrender (ECharts renderer) | 6.1.0 | BSD-3-Clause |
| react, react-dom | 19.3.0 | MIT |
| lucide-react | 1.52.0 | ISC |
| tslib | 2.3.0 | 0BSD |

Full license texts are in each package under `frontend/node_modules/<package>/LICENSE`.

## Apache ECharts NOTICE (required by Apache-2.0 section 4d)

```
Apache ECharts
Copyright 2017-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

## Charting library choice

Lightweight Charts (Apache-2.0) was considered and rejected: its license terms require a
user-visible link to the vendor's website, and by default it draws the vendor's logo on the chart.
SPEC.md section 2 rules out third-party branding in the app.
