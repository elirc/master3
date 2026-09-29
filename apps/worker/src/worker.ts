import "dotenv/config";
import { prisma } from "../../api/src/db";

const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 4000);

async function processOutboxBatch() {
  const events = await prisma.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 10
  });

  for (const event of events) {
    try {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSING", attempts: { increment: 1 } }
      });

      console.log(`[worker] ${event.topic}`, JSON.stringify(event.payload));

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processedAt: new Date() }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "FAILED", lastError: message }
      });
    }
  }
}

async function loop() {
  await processOutboxBatch();
  setTimeout(loop, pollIntervalMs);
}

loop().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
