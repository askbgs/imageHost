import { query } from "@/lib/db";
import {
  applySubscription,
  paddleConfig,
  verifyWebhook,
  type PaddleSubscription,
} from "@/lib/paddle";

export const runtime = "nodejs";

/**
 * Paddle notifications (set this URL as a notification destination in Paddle; see PADDLE.md).
 * Each event is handled once: Paddle retries until it gets a 2xx, so failures return 500.
 */
export async function POST(req: Request) {
  const raw = await req.text(); // the signature covers the exact bytes, so read the body untouched
  if (
    !verifyWebhook(
      raw,
      req.headers.get("paddle-signature"),
      paddleConfig.webhookSecret,
    )
  ) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: { event_id?: string; event_type?: string; data?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const id = event.event_id;
  const type = event.event_type ?? "";
  if (!id) return Response.json({ error: "missing event_id" }, { status: 400 });

  const fresh = await query(
    `INSERT INTO paddle_events (id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
    [id, type],
  );
  if (fresh.length === 0) return Response.json({ ok: true, duplicate: true });

  try {
    if (type.startsWith("subscription.")) {
      const userId = await applySubscription(event.data as PaddleSubscription);
      const sub = event.data as PaddleSubscription;
      console.log(
        `[paddle] ${type} ${sub.id} status=${sub.status} user=${userId ?? "unknown"}`,
      );
    }
    // Other events (transactions, customers, ...) aren't needed: subscription events carry every plan change.
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`[paddle] failed to handle ${type} ${id}:`, err);
    await query(`DELETE FROM paddle_events WHERE id = $1`, [id]).catch(
      () => {},
    );
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
