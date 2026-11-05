import { buildApp } from "./app.js";
import { getHost, getPort } from "./config.js";

const app = buildApp();
await app.listen({ port: getPort(), host: getHost() });
