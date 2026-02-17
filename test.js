/**
 * Overall Design - Correct for MVP
 * You correctly separated:
 * - Persistence -> Prisma + Postgres
 * - Business logic -> service layer
 * - Transport (Realtime) -> Supabase channels
 * - Delivery layer -> Express controllers
 * - Frontend sync mechanism -> broadcast events
 * 
 * Broadcast: Making something widely known, often referring to sharing
 *  private information
 * 
 * - Supabase Realtime uses a WebSocket-based pub/sub system as its
 * transports layer to broadcast changes to subscribed clients
 * 
 * 
 * WHat changed
 * ❌ Removed — getUserConversations (old)
- Grouped by contextType:contextId - meaning Sarah and John has 3 
separate conversations (request, offer, booking)

✅ Replaced with — getUserConversations (new, relationship-based)
- Groups by otherUserId:patientId -- meaning Sarah and John have one
conversation regardless how many stages they've gone through. Always
exactly 2DB queries
 * 
 */