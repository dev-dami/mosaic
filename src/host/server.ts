import homepage from "./index.html";

const port = Number(process.env.PORT ?? 4000);
Bun.serve({ port, routes: { "/": homepage }, development: process.env.NODE_ENV !== "production" });
console.log(`Mosaic on http://localhost:${port}`);
