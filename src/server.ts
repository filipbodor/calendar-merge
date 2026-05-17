import Fastify from "fastify";
import { findMergeBySecret, getHost, getPort } from "./config.js";
import { getCacheStatus, getMergedCalendar } from "./calendarService.js";

const app = Fastify({
  logger: true
});

app.get("/", async () => "calendar-merge ok\n");

app.get("/health", async () => ({
  ok: true,
  ...getCacheStatus()
}));

app.get("/:secret.ics", async (request, reply) => {
  const { secret } = request.params as { secret: string };
  const merge = findMergeBySecret(secret);

  if (!merge) {
    return reply.code(404).send("Not found");
  }

  const calendar = await getMergedCalendar(merge);

  return reply
    .header("content-type", "text/calendar; charset=utf-8")
    .header("cache-control", "private, max-age=300")
    .send(calendar);
});

await app.listen({ port: getPort(), host: getHost() });
